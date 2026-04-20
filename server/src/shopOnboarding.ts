import bcrypt from 'bcrypt';
import { pool } from './db';
import { env } from './env';
import { insertShop } from './shops';

/** Datos iniciales para un shop recién creado (barbero, servicios, horario, reglas). */
export async function seedShopContent(
  shopId: string,
  opts?: { shopDisplayName?: string },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `insert into shop_settings (shop_id, booking_min_lead_hours, booking_max_days_ahead)
       values ($1, 2, 15)
       on conflict (shop_id) do nothing`,
      [shopId],
    );
    const display = opts?.shopDisplayName?.trim();
    if (display) {
      await client.query(
        `update shop_settings set shop_name = $2 where shop_id = $1`,
        [shopId, display],
      );
    }

    const days: [number, boolean, string | null, string | null][] = [
      [0, false, '09:00', '19:00'],
      [1, false, '09:00', '19:00'],
      [2, false, '09:00', '19:00'],
      [3, false, '09:00', '19:00'],
      [4, false, '09:00', '19:00'],
      [5, false, '09:00', '19:00'],
      [6, true, null, null],
    ];
    for (const [dow, closed, open, close] of days) {
      if (closed) {
        await client.query(
          `insert into business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
           values ($1, $2, true, null, null)
           on conflict (shop_id, day_of_week) do nothing`,
          [shopId, dow],
        );
      } else {
        await client.query(
          `insert into business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
           values ($1, $2, false, $3::time, $4::time)
           on conflict (shop_id, day_of_week) do nothing`,
          [shopId, dow, open, close],
        );
      }
    }

    await client.query(
      `insert into barbers (shop_id, name, active) values ($1, $2, true)`,
      [shopId, 'Barbero'],
    );

    await client.query(
      `insert into services (shop_id, name, duration_minutes, price_cents, active)
       values
         ($1, 'Corte', 30, 5000, true),
         ($1, 'Barba', 20, 3500, true)`,
      [shopId],
    );

    await client.query(
      `insert into shop_subscriptions (shop_id, provider, status) values ($1, 'none', 'none')
       on conflict (shop_id) do nothing`,
      [shopId],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function registerShopAndOwner(data: {
  slug: string;
  shopName: string;
  ownerEmail: string;
  ownerPassword: string;
  timezone?: string;
}): Promise<{ shopId: string; slug: string }> {
  const trialEndsAt = new Date(
    Date.now() + env.TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );
  const shop = await insertShop({
    slug: data.slug,
    name: data.shopName,
    timezone: data.timezone,
    status: 'trial',
    trialEndsAt,
  });
  try {
    await seedShopContent(shop.id, { shopDisplayName: data.shopName });
  } catch (e) {
    await pool.query(`delete from shops where id = $1`, [shop.id]);
    throw e;
  }
  const hash = await bcrypt.hash(data.ownerPassword, 10);
  await pool.query(
    `insert into shop_users (shop_id, email, password_hash, role) values ($1, $2, $3, 'owner')`,
    [shop.id, data.ownerEmail.toLowerCase().trim(), hash],
  );
  return { shopId: shop.id, slug: shop.slug };
}
