import { pool } from './db';

export type ShopStatus = 'active' | 'trial' | 'suspended';

export type ShopRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: ShopStatus;
};

export type ShopOverviewRow = {
  id: string;
  slug: string;
  name: string;
  status: ShopStatus;
  timezone: string;
  created_at: string;
  owner_email: string | null;
  subscription_status: string | null;
  subscription_provider: string | null;
  current_period_end: string | null;
  total_appointments: number;
  appointments_this_month: number;
};

/** Nombre legible desde el slug (respaldo en API pública si falta nombre en BD). */
export function displayTitleFromSlug(slug: string): string {
  const s = slug.trim();
  if (!s) return '';
  return s
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export async function getShopBySlug(slug: string): Promise<ShopRow | null> {
  const r = await pool.query<ShopRow>(
    `select id, slug, name, timezone, status::text as status from shops where lower(slug) = lower($1) limit 1`,
    [slug.trim()],
  );
  const row = r.rows[0];
  if (!row) return null;
  return row;
}

/**
 * Devuelve la shop solo si está disponible para rutas públicas (no suspendida).
 * Devuelve `null` si no existe o está suspendida (no distinguimos para no filtrar
 * existencia de slugs).
 */
export async function getPublicShopBySlug(slug: string): Promise<ShopRow | null> {
  const shop = await getShopBySlug(slug);
  if (!shop || shop.status === 'suspended') return null;
  return shop;
}

export async function getShopById(id: string): Promise<ShopRow | null> {
  const r = await pool.query<ShopRow>(
    `select id, slug, name, timezone, status::text as status from shops where id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listShopsOverview(): Promise<ShopOverviewRow[]> {
  const r = await pool.query<{
    id: string;
    slug: string;
    name: string;
    status: string;
    timezone: string;
    created_at: Date;
    owner_email: string | null;
    subscription_status: string | null;
    subscription_provider: string | null;
    current_period_end: Date | null;
    total_appointments: string;
    appointments_this_month: string;
  }>(
    `select
       s.id,
       s.slug,
       s.name,
       s.status::text as status,
       s.timezone,
       s.created_at,
       (
         select email
         from shop_users su
         where su.shop_id = s.id and su.role = 'owner'
         order by su.created_at asc
         limit 1
       ) as owner_email,
       sub.status as subscription_status,
       sub.provider as subscription_provider,
       sub.current_period_end,
       (select count(*) from appointments a where a.shop_id = s.id)::int8 as total_appointments,
       (
         select count(*)
         from appointments a
         where a.shop_id = s.id
           and a.starts_at >= date_trunc('month', now())
       )::int8 as appointments_this_month
     from shops s
     left join shop_subscriptions sub on sub.shop_id = s.id
     order by s.created_at desc`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as ShopStatus,
    timezone: row.timezone,
    created_at: row.created_at.toISOString(),
    owner_email: row.owner_email,
    subscription_status: row.subscription_status,
    subscription_provider: row.subscription_provider,
    current_period_end: row.current_period_end
      ? row.current_period_end.toISOString()
      : null,
    total_appointments: Number(row.total_appointments),
    appointments_this_month: Number(row.appointments_this_month),
  }));
}

export async function updateShopStatus(
  shopId: string,
  status: ShopStatus,
): Promise<ShopRow | null> {
  const r = await pool.query<ShopRow>(
    `update shops set status = $2
     where id = $1
     returning id, slug, name, timezone, status::text as status`,
    [shopId, status],
  );
  return r.rows[0] ?? null;
}

export async function insertShop(data: {
  slug: string;
  name: string;
  timezone?: string;
  status?: ShopStatus;
}): Promise<ShopRow> {
  const r = await pool.query<ShopRow>(
    `insert into shops (slug, name, timezone, status)
     values ($1, $2, coalesce($3, 'America/Argentina/Buenos_Aires'), $4)
     returning id, slug, name, timezone, status::text as status`,
    [
      data.slug.trim(),
      data.name.trim(),
      data.timezone ?? 'America/Argentina/Buenos_Aires',
      data.status ?? 'trial',
    ],
  );
  return r.rows[0]!;
}
