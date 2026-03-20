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
  const where: string[] = ['a.starts_at < $1', 'a.ends_at > $2'];
  const values: unknown[] = [params.to, params.from];

  if (params.barberId) {
    where.push(`a.barber_id = $${values.length + 1}`);
    values.push(params.barberId);
  }

  const sql = `
    select
      a.id,
      a.barber_id,
      a.service_id,
      a.customer_id,
      a.starts_at,
      a.ends_at,
      a.status,
      a.notes,
      a.created_at,
      b.name as barber_name,
      s.name as service_name,
      c.name as customer_name,
      c.phone as customer_phone,
      c.email as customer_email
    from appointments a
    join barbers b on b.id = a.barber_id
    join services s on s.id = a.service_id
    join customers c on c.id = a.customer_id
    where ${where.join(' and ')}
    order by a.starts_at asc
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

