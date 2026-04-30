import { pool } from './db';
import { env } from './env';
import { getShopBySlug } from './shops';

/** Nombre visible del shop demo al restablecer. */
const DEMO_SHOP_NAME = 'Barbería demo';
const DEMO_BARBER_NAME = 'Carlos';

/** Servicios base del demo. El primero queda marcado como favorito. */
const DEMO_SERVICES: Array<{
  name: string;
  duration_minutes: number;
  price_cents: number;
  is_favorite: boolean;
}> = [
  { name: 'Corte', duration_minutes: 30, price_cents: 1000000, is_favorite: true },
  { name: 'Barba', duration_minutes: 20, price_cents: 500000, is_favorite: false },
];

/** Horario base: Lun–Sáb 09:00–19:00, Dom cerrado. */
const DEMO_BUSINESS_HOURS: Array<{
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}> = [
  { day_of_week: 0, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 1, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 2, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 3, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 4, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 5, is_closed: false, open_time: '09:00', close_time: '19:00' },
  { day_of_week: 6, is_closed: true, open_time: null, close_time: null },
];

/**
 * Limpia los datos editables del shop demo y los deja en sus valores por
 * defecto. Solo puede usarse sobre el shop demo (slug configurado en env).
 */
export async function resetDemoShop(): Promise<void> {
  const slug = env.DEFAULT_SHOP_SLUG;
  const shop = await getShopBySlug(slug);
  if (!shop) return;

  const client = await pool.connect();
  try {
    await client.query('begin');

    await client.query(`delete from appointments where shop_id = $1`, [shop.id]);
    await client.query(`delete from blocked_ranges where shop_id = $1`, [shop.id]);
    await client.query(`delete from customers where shop_id = $1`, [shop.id]);
    await client.query(`delete from services where shop_id = $1`, [shop.id]);
    await client.query(`delete from barbers where shop_id = $1`, [shop.id]);

    await client.query(
      `insert into barbers (shop_id, name, active) values ($1, $2, true)`,
      [shop.id, DEMO_BARBER_NAME],
    );

    for (const svc of DEMO_SERVICES) {
      await client.query(
        `insert into services (shop_id, name, duration_minutes, price_cents, active, is_favorite)
         values ($1, $2, $3, $4, true, $5)`,
        [shop.id, svc.name, svc.duration_minutes, svc.price_cents, svc.is_favorite],
      );
    }

    await client.query(`update shops set name = $2 where id = $1`, [
      shop.id,
      DEMO_SHOP_NAME,
    ]);

    await client.query(
      `update shop_settings set
         shop_name = $2,
         contact_whatsapp = null,
         contact_email = null,
         contact_address = null,
         address_street = null,
         address_number = null,
         address_floor = null,
         address_city = null,
         address_region = null,
         address_postal_code = null,
         booking_min_lead_hours = 2,
         booking_max_days_ahead = 15
       where shop_id = $1`,
      [shop.id, DEMO_SHOP_NAME],
    );

    await client.query(`delete from business_hours where shop_id = $1`, [shop.id]);
    for (const bh of DEMO_BUSINESS_HOURS) {
      await client.query(
        `insert into business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
         values ($1, $2, $3, $4::time, $5::time)`,
        [shop.id, bh.day_of_week, bh.is_closed, bh.open_time, bh.close_time],
      );
    }

    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
