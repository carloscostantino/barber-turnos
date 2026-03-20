import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';
import { env } from './env';
import { getService, listAppointments, listBarbers, listServices } from './api';
import {
  AvailabilityQuery,
  CreateAppointmentBody,
  formatZodError,
  ListAppointmentsQuery,
  UpdateAppointmentStatusBody,
  UUID,
} from './validation';

export const router = Router();

router.get('/barbers', async (_req, res) => {
  const barbers = await listBarbers();
  res.json(barbers);
});

router.get('/services', async (_req, res) => {
  const services = await listServices();
  res.json(services);
});

router.get('/appointments', async (req, res) => {
  const parsed = ListAppointmentsQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const rows = await listAppointments({
    barberId: parsed.data.barberId,
    from: new Date(parsed.data.from),
    to: new Date(parsed.data.to),
  });
  res.json(rows);
});

router.patch('/appointments/:id/status', async (req, res) => {
  const idParsed = UUID.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });

  const bodyParsed = UpdateAppointmentStatusBody.safeParse(req.body);
  if (!bodyParsed.success)
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });

  const result = await pool.query(
    `update appointments set status = $2 where id = $1 returning id, status`,
    [idParsed.data, bodyParsed.data.status],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'turno no encontrado' });
  res.json(row);
});

router.get('/availability', async (req, res) => {
  const parsed = AvailabilityQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const service = await getService(parsed.data.serviceId);
  if (!service) return res.status(404).json({ error: 'servicio no encontrado' });

  const durationMin = service.duration_minutes;

  // Ventana base (día) en timezone configurada: 09:00-19:00.
  // Implementación simple: asumimos que `date` viene en el timezone del negocio
  // y generamos slots en esa misma zona usando offset local del servidor.
  const dayStart = new Date(`${parsed.data.date}T09:00:00`);
  const dayEnd = new Date(`${parsed.data.date}T19:00:00`);

  const existing = await pool.query(
    `
      select starts_at, ends_at
      from appointments
      where barber_id = $1
        and status <> 'cancelled'
        and starts_at < $2
        and ends_at > $3
      order by starts_at asc
    `,
    [parsed.data.barberId, dayEnd, dayStart],
  );

  const busy = existing.rows.map((r) => ({
    startsAt: new Date(r.starts_at).getTime(),
    endsAt: new Date(r.ends_at).getTime(),
  }));

  const slots: { startsAt: string; endsAt: string }[] = [];
  const stepMs = 15 * 60 * 1000;
  const durationMs = durationMin * 60 * 1000;

  for (let t = dayStart.getTime(); t + durationMs <= dayEnd.getTime(); t += stepMs) {
    const slotStart = t;
    const slotEnd = t + durationMs;
    const overlaps = busy.some((b) => slotStart < b.endsAt && slotEnd > b.startsAt);
    if (!overlaps) {
      slots.push({
        startsAt: new Date(slotStart).toISOString(),
        endsAt: new Date(slotEnd).toISOString(),
      });
    }
  }

  res.json({
    timezone: env.TIMEZONE,
    service,
    slots,
  });
});

router.post('/appointments', async (req, res) => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const service = await getService(parsed.data.serviceId);
  if (!service) return res.status(404).json({ error: 'servicio no encontrado' });

  const startsAt = new Date(parsed.data.startsAt);
  if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'startsAt inválido' });

  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Upsert de cliente por teléfono.
    const customerResult = await client.query(
      `
        insert into customers (name, phone, email)
        values ($1, $2, $3)
        on conflict (phone)
        do update set name = excluded.name, email = coalesce(excluded.email, customers.email)
        returning id
      `,
      [parsed.data.customer.name, parsed.data.customer.phone, parsed.data.customer.email ?? null],
    );

    const customerId = customerResult.rows[0]?.id as string | undefined;
    if (!customerId) throw new Error('no se pudo crear/leer customer');

    // Chequeo de solapamiento (y lock suave por ventana).
    const overlap = await client.query(
      `
        select 1
        from appointments
        where barber_id = $1
          and status <> 'cancelled'
          and starts_at < $2
          and ends_at > $3
        limit 1
      `,
      [parsed.data.barberId, endsAt, startsAt],
    );
    if (overlap.rowCount && overlap.rowCount > 0) {
      await client.query('rollback');
      return res.status(409).json({ error: 'ese horario ya está ocupado' });
    }

    const appointmentResult = await client.query(
      `
        insert into appointments (
          barber_id, service_id, customer_id, starts_at, ends_at, status, notes
        )
        values ($1, $2, $3, $4, $5, 'pending', $6)
        returning id, barber_id, service_id, customer_id, starts_at, ends_at, status, notes, created_at
      `,
      [
        parsed.data.barberId,
        parsed.data.serviceId,
        customerId,
        startsAt,
        endsAt,
        parsed.data.notes ?? null,
      ],
    );

    await client.query('commit');
    res.status(201).json(appointmentResult.rows[0]);
  } catch (e) {
    await client.query('rollback');
    const msg = e instanceof Error ? e.message : 'error';
    res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
});

