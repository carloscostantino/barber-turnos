import { z } from 'zod';
import { pool } from './db';

const UUID = z.string().uuid();

const ServiceRowSchema = z.object({
  id: UUID,
  name: z.string(),
  duration_minutes: z.number().int(),
  price_cents: z.number().int(),
});

const BarberRowSchema = z.object({
  id: UUID,
  name: z.string(),
});

export async function listBarbers() {
  const result = await pool.query('select id, name from barbers order by name asc');
  return z.array(BarberRowSchema).parse(result.rows);
}

export async function listServices() {
  const result = await pool.query(
    'select id, name, duration_minutes, price_cents from services order by name asc',
  );
  return z.array(ServiceRowSchema).parse(result.rows);
}

export async function getService(serviceId: string) {
  const result = await pool.query(
    'select id, name, duration_minutes, price_cents from services where id = $1',
    [serviceId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return ServiceRowSchema.parse(row);
}

export async function listAppointments(params: {
  barberId?: string;
  from: Date;
  to: Date;
}) {
  const where: string[] = ['starts_at < $1', 'ends_at > $2'];
  const values: unknown[] = [params.to, params.from];

  if (params.barberId) {
    where.push(`barber_id = $${values.length + 1}`);
    values.push(params.barberId);
  }

  const sql = `
    select
      id, barber_id, service_id, customer_id,
      starts_at, ends_at, status, notes, created_at
    from appointments
    where ${where.join(' and ')}
    order by starts_at asc
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

