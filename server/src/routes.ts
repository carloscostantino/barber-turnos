import { Router } from 'express';
import { requireAdmin, signAdminToken, verifyAdminPassword } from './adminAuth';
import {
  countActiveAppointmentsOverlappingRange,
  deleteBlockedRange,
  getAppointmentForEmail,
  getService,
  getSingleActiveBarberId,
  insertBlockedRange,
  insertService,
  listAppointments,
  listBarbersPublic,
  listBlockedRanges,
  listServices,
  updateService,
} from './api';
import { pool } from './db';
import { env } from './env';
import {
  createMailer,
  formatAppointmentDateTimeLabel,
  sendAppointmentCancelledEmail,
} from './mailer';
import {
  assertBookingAllowed,
  blockedRangeForShopCalendarDay,
  computeAvailableSlots,
  getShopSettings,
  listBusinessHours,
  replaceBusinessHours,
  updateShopSettings,
} from './scheduling';
import {
  AdminLoginBody,
  AvailabilityQuery,
  BlockedRangeCreateBody,
  BusinessHoursPutBody,
  CreateAppointmentBody,
  formatZodError,
  ListAppointmentsQuery,
  ServiceCreateBody,
  ServiceUpdateBody,
  ShopSettingsBody,
  UpdateAppointmentStatusBody,
  UUID,
} from './validation';

export const router = Router();

router.get('/barbers', async (_req, res) => {
  const barbers = await listBarbersPublic();
  res.json(barbers);
});

router.get('/services', async (_req, res) => {
  const services = await listServices(true);
  res.json(services);
});

router.get('/public-settings', async (_req, res) => {
  const barberId = await getSingleActiveBarberId();
  const settings = await getShopSettings();
  const whatsappFromDb = settings.contactWhatsapp?.trim();
  res.json({
    whatsappNumber: whatsappFromDb || env.WHATSAPP_NUMBER || null,
    contactEmail: settings.contactEmail,
    contactAddress: settings.contactAddress,
    barberId,
    timezone: env.TIMEZONE,
    bookingMinLeadHours: settings.bookingMinLeadHours,
    bookingMaxDaysAhead: settings.bookingMaxDaysAhead,
  });
});

router.post('/admin/login', async (req, res) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  if (!(await verifyAdminPassword(parsed.data.password))) {
    return res.status(401).json({ error: 'credenciales incorrectas' });
  }

  const token = signAdminToken();
  res.json({ token, expiresInSec: 7 * 24 * 60 * 60 });
});

router.get('/appointments', requireAdmin, async (req, res) => {
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

router.patch('/appointments/:id/status', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });

  const bodyParsed = UpdateAppointmentStatusBody.safeParse(req.body);
  if (!bodyParsed.success)
    return res.status(400).json({ error: formatZodError(bodyParsed.error) });

  const cancellationNote = bodyParsed.data.cancellationNote;

  const prev = await pool.query<{ status: string }>(
    `select status from appointments where id = $1`,
    [idParsed.data],
  );
  if (!prev.rows[0]) return res.status(404).json({ error: 'turno no encontrado' });

  const result = await pool.query(
    `update appointments set status = $2 where id = $1 returning id, status`,
    [idParsed.data, bodyParsed.data.status],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'turno no encontrado' });

  if (
    bodyParsed.data.status === 'cancelled' &&
    prev.rows[0].status !== 'cancelled'
  ) {
    const appt = await getAppointmentForEmail(idParsed.data);
    if (appt?.email && appt.email.trim()) {
      const transporter = createMailer();
      if (transporter) {
        try {
          await sendAppointmentCancelledEmail(transporter, {
            to: appt.email.trim(),
            customerName: appt.customer_name,
            serviceName: appt.service_name,
            startsAtLabel: formatAppointmentDateTimeLabel(new Date(appt.starts_at)),
            cancellationNote: cancellationNote?.trim() || undefined,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            '[cancel email]',
            e instanceof Error ? e.message : e,
          );
        }
      }
    }
  }

  res.json(row);
});

router.get('/availability', async (req, res) => {
  const parsed = AvailabilityQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const barberId = await getSingleActiveBarberId();
  if (!barberId) {
    return res.status(503).json({ error: 'no hay barbero activo configurado' });
  }

  const result = await computeAvailableSlots({
    dateStr: parsed.data.date,
    barberId,
    serviceId: parsed.data.serviceId,
  });

  if ('error' in result) {
    return res.status(404).json({ error: result.error });
  }

  res.json({
    timezone: result.timezone,
    service: result.service,
    slots: result.slots,
  });
});

router.post('/appointments', async (req, res) => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const barberId = await getSingleActiveBarberId();
  if (!barberId) {
    return res.status(503).json({ error: 'no hay barbero activo configurado' });
  }

  const service = await getService(parsed.data.serviceId);
  if (!service) return res.status(404).json({ error: 'servicio no encontrado' });

  const startsAt = new Date(parsed.data.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    return res.status(400).json({ error: 'startsAt inválido' });

  const allowed = await assertBookingAllowed({
    startsAt,
    barberId,
    serviceId: parsed.data.serviceId,
  });
  if (!allowed.ok) return res.status(400).json({ error: allowed.error });

  const endsAt = new Date(
    startsAt.getTime() + service.duration_minutes * 60 * 1000,
  );

  const client = await pool.connect();
  try {
    await client.query('begin');

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
      [barberId, endsAt, startsAt],
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
        values ($1, $2, $3, $4, $5, 'confirmed', $6)
        returning id, barber_id, service_id, customer_id, starts_at, ends_at, status, notes, created_at
      `,
      [
        barberId,
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

router.get('/admin/shop-settings', requireAdmin, async (_req, res) => {
  const s = await getShopSettings();
  res.json(s);
});

router.put('/admin/shop-settings', requireAdmin, async (req, res) => {
  const parsed = ShopSettingsBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  const s = await updateShopSettings({
    bookingMinLeadHours: parsed.data.bookingMinLeadHours,
    bookingMaxDaysAhead: parsed.data.bookingMaxDaysAhead,
    contactWhatsapp: parsed.data.contactWhatsapp,
    contactEmail: parsed.data.contactEmail,
    contactAddress: parsed.data.contactAddress,
  });
  res.json(s);
});

router.get('/admin/business-hours', requireAdmin, async (_req, res) => {
  const rows = await listBusinessHours();
  res.json(rows);
});

router.put('/admin/business-hours', requireAdmin, async (req, res) => {
  const parsed = BusinessHoursPutBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  const daySet = new Set(parsed.data.map((d) => d.dayOfWeek));
  if (daySet.size !== 7) {
    return res.status(400).json({
      error: 'enviá los 7 días de la semana (0–6) sin repetir',
    });
  }

  for (const row of parsed.data) {
    if (!row.isClosed) {
      if (!row.openTime || !row.closeTime) {
        return res.status(400).json({
          error: `día ${row.dayOfWeek}: si abre, indicá hora de apertura y cierre`,
        });
      }
      if (row.openTime >= row.closeTime) {
        return res.status(400).json({
          error: `día ${row.dayOfWeek}: la apertura debe ser antes del cierre`,
        });
      }
    }
  }

  await replaceBusinessHours(
    parsed.data.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      isClosed: r.isClosed,
      openTime: r.openTime,
      closeTime: r.closeTime,
    })),
  );
  res.json({ ok: true });
});

router.get('/admin/services', requireAdmin, async (_req, res) => {
  const rows = await listServices(false);
  res.json(rows);
});

router.post('/admin/services', requireAdmin, async (req, res) => {
  const parsed = ServiceCreateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  const row = await insertService(parsed.data);
  res.status(201).json(row);
});

router.patch('/admin/services/:id', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const parsed = ServiceUpdateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: 'sin cambios' });
  }
  const row = await updateService(idParsed.data, parsed.data);
  if (!row) return res.status(404).json({ error: 'servicio no encontrado' });
  res.json(row);
});

router.get('/admin/blocked-ranges', requireAdmin, async (_req, res) => {
  const rows = await listBlockedRanges();
  res.json(rows);
});

router.post('/admin/blocked-ranges', requireAdmin, async (req, res) => {
  const parsed = BlockedRangeCreateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: formatZodError(parsed.error) });

  let startsAt: Date;
  let endsAt: Date;
  let note: string | undefined;

  if ('blockedDate' in parsed.data) {
    try {
      const r = blockedRangeForShopCalendarDay(parsed.data.blockedDate);
      startsAt = r.startsAt;
      endsAt = r.endsAt;
      note = parsed.data.note;
    } catch {
      return res.status(400).json({ error: 'fecha inválida' });
    }
  } else {
    startsAt = new Date(parsed.data.startsAt);
    endsAt = new Date(parsed.data.endsAt);
    note = parsed.data.note;
    if (!(endsAt > startsAt)) {
      return res.status(400).json({ error: 'endsAt debe ser posterior a startsAt' });
    }
  }

  const barberId = await getSingleActiveBarberId();
  const n = await countActiveAppointmentsOverlappingRange(
    startsAt,
    endsAt,
    barberId ?? undefined,
  );
  if (n > 0) {
    return res.status(409).json({
      error:
        'hay turnos activos en ese rango; cancelalos o reubicá antes de bloquear',
    });
  }

  const row = await insertBlockedRange({
    startsAt,
    endsAt,
    note,
  });
  res.status(201).json(row);
});

router.delete('/admin/blocked-ranges/:id', requireAdmin, async (req, res) => {
  const idParsed = UUID.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: 'id inválido' });
  const ok = await deleteBlockedRange(idParsed.data);
  if (!ok) return res.status(404).json({ error: 'bloqueo no encontrado' });
  res.status(204).send();
});
