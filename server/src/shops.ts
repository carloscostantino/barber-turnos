import { pool } from './db';

export type ShopRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: 'active' | 'trial' | 'suspended';
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

export async function getShopById(id: string): Promise<ShopRow | null> {
  const r = await pool.query<ShopRow>(
    `select id, slug, name, timezone, status::text as status from shops where id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function insertShop(data: {
  slug: string;
  name: string;
  timezone?: string;
  status?: 'active' | 'trial' | 'suspended';
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
