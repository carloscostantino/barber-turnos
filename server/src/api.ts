import { z } from 'zod';
import { pool } from './db';

const UUID = z.string().uuid();

const ServiceRowSchema = z.object({
  id: UUID,
  name: z.string(),
  duration_minutes: z.number().int(),
  price_cents: z.number().int(),
  active: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
});

const BarberIdSchema = z.object({
  id: UUID,
});

export async function listBarbersPublic() {
  const result = await pool.query('select id from barbers where active = true order by id asc limit 1');
  return z.array(BarberIdSchema).parse(result.rows);
}

/** Admin: incluye barberos inactivos. */
export async function listBarbersAdmin() {
  const result = await pool.query('select id, name, active from barbers order by name asc');
  return result.rows;
}

export async function getSingleActiveBarberId(): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    'select id from barbers where active = true order by id asc limit 1',
  );
  return r.rows[0]?.id ?? null;
}

export async function listServices(activeOnly = true) {
  const sql = activeOnly
    ? 'select id, name, duration_minutes, price_cents, is_favorite from services where active = true order by is_favorite desc, name asc'
    : 'select id, name, duration_minutes, price_cents, active, is_favorite from services order by is_favorite desc, name asc';
  const result = await pool.query(sql);
  return z.array(ServiceRowSchema).parse(result.rows);
}

export async function getService(serviceId: string, activeOnly = true) {
  const sql = activeOnly
    ? 'select id, name, duration_minutes, price_cents, is_favorite from services where id = $1 and active = true'
    : 'select id, name, duration_minutes, price_cents, active, is_favorite from services where id = $1';
  const result = await pool.query(sql, [serviceId]);
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
      a.attended,
      a.notes,
      a.created_at,
      s.name as service_name,
      c.name as customer_name,
      c.phone as customer_phone,
      c.email as customer_email
    from appointments a
    join services s on s.id = a.service_id
    join customers c on c.id = a.customer_id
    where ${where.join(' and ')}
    order by a.starts_at asc
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

export async function getAppointmentForEmail(appointmentId: string) {
  const r = await pool.query(
    `select a.starts_at, a.ends_at, s.name as service_name, c.email, c.name as customer_name
     from appointments a
     join services s on s.id = a.service_id
     join customers c on c.id = a.customer_id
     where a.id = $1`,
    [appointmentId],
  );
  return r.rows[0] as
    | {
        starts_at: Date;
        ends_at: Date;
        service_name: string;
        email: string | null;
        customer_name: string;
      }
    | undefined;
}

/** Solape con rango [rangeStart, rangeEnd). */
export async function countActiveAppointmentsOverlappingRange(
  rangeStart: Date,
  rangeEnd: Date,
  barberId?: string,
): Promise<number> {
  const params: unknown[] = [rangeStart, rangeEnd];
  let barberClause = '';
  if (barberId) {
    barberClause = ' and barber_id = $3';
    params.push(barberId);
  }
  const r = await pool.query<{ c: string }>(
    `select count(*)::text as c from appointments
     where status <> 'cancelled' and starts_at < $2 and ends_at > $1 ${barberClause}`,
    params,
  );
  return parseInt(r.rows[0]?.c ?? '0', 10);
}

export async function insertService(data: {
  name: string;
  duration_minutes: number;
  price_cents: number;
}) {
  const r = await pool.query(
    `insert into services (name, duration_minutes, price_cents) values ($1, $2, $3)
     returning id, name, duration_minutes, price_cents, active, is_favorite`,
    [data.name, data.duration_minutes, data.price_cents],
  );
  return r.rows[0];
}

export async function updateService(
  id: string,
  data: Partial<{
    name: string;
    duration_minutes: number;
    price_cents: number;
    active: boolean;
    is_favorite: boolean;
  }>,
) {
  if (data.is_favorite === true) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('update services set is_favorite = false');
      await client.query('update services set is_favorite = true where id = $1', [id]);
      const fields: string[] = [];
      const vals: unknown[] = [];
      let n = 1;
      if (data.name !== undefined) {
        fields.push(`name = $${n++}`);
        vals.push(data.name);
      }
      if (data.duration_minutes !== undefined) {
        fields.push(`duration_minutes = $${n++}`);
        vals.push(data.duration_minutes);
      }
      if (data.price_cents !== undefined) {
        fields.push(`price_cents = $${n++}`);
        vals.push(data.price_cents);
      }
      if (data.active !== undefined) {
        fields.push(`active = $${n++}`);
        vals.push(data.active);
      }
      if (fields.length > 0) {
        vals.push(id);
        await client.query(
          `update services set ${fields.join(', ')} where id = $${n}`,
          vals,
        );
      }
      await client.query('COMMIT');
      const r = await pool.query(
        `select id, name, duration_minutes, price_cents, active, is_favorite from services where id = $1`,
        [id],
      );
      return r.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const fields: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (data.is_favorite === false) {
    fields.push(`is_favorite = $${n++}`);
    vals.push(false);
  }
  if (data.name !== undefined) {
    fields.push(`name = $${n++}`);
    vals.push(data.name);
  }
  if (data.duration_minutes !== undefined) {
    fields.push(`duration_minutes = $${n++}`);
    vals.push(data.duration_minutes);
  }
  if (data.price_cents !== undefined) {
    fields.push(`price_cents = $${n++}`);
    vals.push(data.price_cents);
  }
  if (data.active !== undefined) {
    fields.push(`active = $${n++}`);
    vals.push(data.active);
  }
  if (fields.length === 0) return null;
  vals.push(id);
  const r = await pool.query(
    `update services set ${fields.join(', ')} where id = $${n} returning id, name, duration_minutes, price_cents, active, is_favorite`,
    vals,
  );
  return r.rows[0];
}

export async function listBlockedRanges() {
  const r = await pool.query(
    `select id, starts_at, ends_at, note, created_at from blocked_ranges order by starts_at desc`,
  );
  return r.rows;
}

export async function insertBlockedRange(data: {
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
}) {
  const r = await pool.query(
    `insert into blocked_ranges (starts_at, ends_at, note) values ($1, $2, $3)
     returning id, starts_at, ends_at, note, created_at`,
    [data.startsAt, data.endsAt, data.note ?? null],
  );
  return r.rows[0];
}

export async function deleteBlockedRange(id: string): Promise<boolean> {
  const r = await pool.query(`delete from blocked_ranges where id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function updateAppointmentAttendance(
  id: string,
  attended: boolean | null,
): Promise<unknown | null> {
  const r = await pool.query(
    `update appointments set attended = $2 where id = $1 returning id, attended`,
    [id, attended],
  );
  return r.rows[0] ?? null;
}
