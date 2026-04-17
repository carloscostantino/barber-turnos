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

export async function listBarbersPublic(shopId: string) {
  const result = await pool.query(
    'select id from barbers where shop_id = $1 and active = true order by id asc limit 1',
    [shopId],
  );
  return z.array(BarberIdSchema).parse(result.rows);
}

/** Admin: incluye barberos inactivos. */
export async function listBarbersAdmin(shopId: string) {
  const result = await pool.query(
    'select id, name, active from barbers where shop_id = $1 order by name asc',
    [shopId],
  );
  return result.rows;
}

export async function getSingleActiveBarberId(shopId: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    'select id from barbers where shop_id = $1 and active = true order by id asc limit 1',
    [shopId],
  );
  return r.rows[0]?.id ?? null;
}

export async function listServices(shopId: string, activeOnly = true) {
  const sql = activeOnly
    ? 'select id, name, duration_minutes, price_cents, is_favorite from services where shop_id = $1 and active = true order by is_favorite desc, name asc'
    : 'select id, name, duration_minutes, price_cents, active, is_favorite from services where shop_id = $1 order by is_favorite desc, name asc';
  const result = await pool.query(sql, [shopId]);
  return z.array(ServiceRowSchema).parse(result.rows);
}

export async function getService(shopId: string, serviceId: string, activeOnly = true) {
  const sql = activeOnly
    ? 'select id, name, duration_minutes, price_cents, is_favorite from services where shop_id = $1 and id = $2 and active = true'
    : 'select id, name, duration_minutes, price_cents, active, is_favorite from services where shop_id = $1 and id = $2';
  const result = await pool.query(sql, [shopId, serviceId]);
  const row = result.rows[0];
  if (!row) return null;
  return ServiceRowSchema.parse(row);
}

export async function listAppointments(params: {
  shopId: string;
  barberId?: string;
  from: Date;
  to: Date;
}) {
  const where: string[] = ['a.shop_id = $3', 'a.starts_at < $1', 'a.ends_at > $2'];
  const values: unknown[] = [params.to, params.from, params.shopId];

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
    `select a.starts_at, a.ends_at, s.name as service_name, c.email, c.name as customer_name,
            sh.slug as shop_slug
     from appointments a
     join services s on s.id = a.service_id
     join customers c on c.id = a.customer_id
     join shops sh on sh.id = a.shop_id
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
        shop_slug: string;
      }
    | undefined;
}

/** Solape con rango [rangeStart, rangeEnd). */
export async function countActiveAppointmentsOverlappingRange(
  shopId: string,
  rangeStart: Date,
  rangeEnd: Date,
  barberId?: string,
): Promise<number> {
  const params: unknown[] = [shopId, rangeStart, rangeEnd];
  let barberClause = '';
  if (barberId) {
    barberClause = ' and barber_id = $4';
    params.push(barberId);
  }
  const r = await pool.query<{ c: string }>(
    `select count(*)::text as c from appointments
     where shop_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2 ${barberClause}`,
    params,
  );
  return parseInt(r.rows[0]?.c ?? '0', 10);
}

export async function insertService(
  shopId: string,
  data: {
    name: string;
    duration_minutes: number;
    price_cents: number;
  },
) {
  const r = await pool.query(
    `insert into services (shop_id, name, duration_minutes, price_cents) values ($1, $2, $3, $4)
     returning id, name, duration_minutes, price_cents, active, is_favorite`,
    [shopId, data.name, data.duration_minutes, data.price_cents],
  );
  return r.rows[0];
}

export async function updateService(
  shopId: string,
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
      await client.query('update services set is_favorite = false where shop_id = $1', [shopId]);
      await client.query('update services set is_favorite = true where shop_id = $1 and id = $2', [
        shopId,
        id,
      ]);
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
        vals.push(shopId, id);
        await client.query(
          `update services set ${fields.join(', ')} where shop_id = $${n} and id = $${n + 1}`,
          vals,
        );
      }
      await client.query('COMMIT');
      const r = await pool.query(
        `select id, name, duration_minutes, price_cents, active, is_favorite from services where shop_id = $1 and id = $2`,
        [shopId, id],
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
  vals.push(shopId, id);
  const r = await pool.query(
    `update services set ${fields.join(', ')} where shop_id = $${n} and id = $${n + 1} returning id, name, duration_minutes, price_cents, active, is_favorite`,
    vals,
  );
  return r.rows[0];
}

export async function deleteServiceIfUnused(
  shopId: string,
  id: string,
): Promise<'ok' | 'not_found' | 'has_appointments'> {
  const exists = await pool.query(`select 1 from services where shop_id = $1 and id = $2`, [
    shopId,
    id,
  ]);
  if (exists.rows.length === 0) return 'not_found';

  const cnt = await pool.query<{ c: string }>(
    `select count(*)::text as c from appointments where service_id = $1`,
    [id],
  );
  const n = parseInt(cnt.rows[0]?.c ?? '0', 10);
  if (n > 0) return 'has_appointments';

  await pool.query(`delete from services where shop_id = $1 and id = $2`, [shopId, id]);
  return 'ok';
}

export async function listBlockedRanges(shopId: string) {
  const r = await pool.query(
    `select id, starts_at, ends_at, note, created_at from blocked_ranges where shop_id = $1 order by starts_at desc`,
    [shopId],
  );
  return r.rows;
}

export async function insertBlockedRange(
  shopId: string,
  data: {
    startsAt: Date;
    endsAt: Date;
    note?: string | null;
  },
) {
  const r = await pool.query(
    `insert into blocked_ranges (shop_id, starts_at, ends_at, note) values ($1, $2, $3, $4)
     returning id, starts_at, ends_at, note, created_at`,
    [shopId, data.startsAt, data.endsAt, data.note ?? null],
  );
  return r.rows[0];
}

export async function deleteBlockedRange(shopId: string, id: string): Promise<boolean> {
  const r = await pool.query(`delete from blocked_ranges where shop_id = $1 and id = $2`, [
    shopId,
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export async function updateAppointmentAttendance(
  shopId: string,
  id: string,
  attended: boolean | null,
): Promise<unknown | null> {
  const r = await pool.query(
    `update appointments set attended = $3 where shop_id = $1 and id = $2 returning id, attended`,
    [shopId, id, attended],
  );
  return r.rows[0] ?? null;
}
