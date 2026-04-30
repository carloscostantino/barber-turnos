import { pool } from './db';
import { env } from './env';

export type CurrentPlatformSettings = {
  subscriptionPriceArs: number;
  subscriptionReason: string;
  updatedAt: string;
};

export type PendingPriceChange = {
  priceArs: number;
  effectiveAt: string;
};

export type PlatformSettings = {
  current: CurrentPlatformSettings;
  pending: PendingPriceChange | null;
};

type Row = {
  subscription_price_ars: number;
  subscription_reason: string;
  pending_price_ars: number | null;
  pending_effective_at: Date | null;
  updated_at: Date;
};

/**
 * Error arrojado cuando se intenta programar un cambio con otro ya pendiente.
 * El endpoint lo convierte en 409 con el pendiente en el body.
 */
export class PendingChangeExistsError extends Error {
  readonly pending: PendingPriceChange;
  constructor(pending: PendingPriceChange) {
    super('hay un cambio de precio pendiente');
    this.name = 'PendingChangeExistsError';
    this.pending = pending;
  }
}

/**
 * El precio nuevo es igual al vigente; no tiene sentido programar el cambio.
 */
export class NoChangeError extends Error {
  constructor() {
    super('el precio nuevo coincide con el vigente');
    this.name = 'NoChangeError';
  }
}

function mapRow(row: Row): PlatformSettings {
  const pending =
    row.pending_price_ars !== null && row.pending_effective_at !== null
      ? {
          priceArs: row.pending_price_ars,
          effectiveAt: row.pending_effective_at.toISOString(),
        }
      : null;
  return {
    current: {
      subscriptionPriceArs: row.subscription_price_ars,
      subscriptionReason: row.subscription_reason,
      updatedAt: row.updated_at.toISOString(),
    },
    pending,
  };
}

async function readRow(): Promise<Row | null> {
  const r = await pool.query<Row>(
    `select subscription_price_ars, subscription_reason,
            pending_price_ars, pending_effective_at, updated_at
       from platform_settings where id = 1 limit 1`,
  );
  return r.rows[0] ?? null;
}

/**
 * Devuelve la configuración vigente + cambio pendiente (si lo hay).
 * Si la tabla está vacía (no debería pasar post-migración, pero por
 * defensa) devuelve los defaults de env sin persistir.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const row = await readRow();
  if (row) return mapRow(row);
  return {
    current: {
      subscriptionPriceArs: env.MP_SUBSCRIPTION_AMOUNT_ARS,
      subscriptionReason: env.MP_SUBSCRIPTION_REASON,
      updatedAt: new Date(0).toISOString(),
    },
    pending: null,
  };
}

/**
 * Programa un cambio de precio. La fecha efectiva se calcula como
 * `now() + PRICE_CHANGE_WINDOW_DAYS días`. No actualiza MP: eso lo hace el job
 * cuando la fecha vence.
 *
 * Devuelve además el `oldPriceArs` vigente al momento de programar, útil para
 * redactar el email.
 */
export async function schedulePriceChange(args: {
  newPriceArs: number;
}): Promise<{ settings: PlatformSettings; oldPriceArs: number }> {
  const current = await getPlatformSettings();
  if (current.pending) {
    throw new PendingChangeExistsError(current.pending);
  }
  if (current.current.subscriptionPriceArs === args.newPriceArs) {
    throw new NoChangeError();
  }
  const windowDays = env.PRICE_CHANGE_WINDOW_DAYS;
  const r = await pool.query<Row>(
    `update platform_settings
        set pending_price_ars = $1,
            pending_effective_at = now() + ($2::int * interval '1 day'),
            updated_at = now()
      where id = 1
      returning subscription_price_ars, subscription_reason,
                pending_price_ars, pending_effective_at, updated_at`,
    [args.newPriceArs, windowDays],
  );
  const row = r.rows[0];
  if (!row) throw new Error('platform_settings no inicializado');
  return {
    settings: mapRow(row),
    oldPriceArs: current.current.subscriptionPriceArs,
  };
}

/**
 * Limpia el cambio pendiente (si lo hubiera). Idempotente: si no había
 * pendiente devuelve `{ cancelled: null }`.
 */
export async function cancelPendingPriceChange(): Promise<{
  settings: PlatformSettings;
  cancelled: PendingPriceChange | null;
}> {
  const before = await getPlatformSettings();
  if (!before.pending) {
    return { settings: before, cancelled: null };
  }
  const r = await pool.query<Row>(
    `update platform_settings
        set pending_price_ars = null,
            pending_effective_at = null,
            updated_at = now()
      where id = 1
      returning subscription_price_ars, subscription_reason,
                pending_price_ars, pending_effective_at, updated_at`,
  );
  const row = r.rows[0];
  if (!row) throw new Error('platform_settings no inicializado');
  return { settings: mapRow(row), cancelled: before.pending };
}

/**
 * Si el pendiente ya venció, mueve `pending_*` a `subscription_price_ars` y
 * devuelve el nuevo precio para que el job llame a MP. Si no hay nada que
 * promover devuelve `{ promoted: false }`.
 */
export async function promotePendingPriceIfDue(): Promise<
  { promoted: true; newPrice: number } | { promoted: false }
> {
  const r = await pool.query<{ subscription_price_ars: number }>(
    `update platform_settings
        set subscription_price_ars = pending_price_ars,
            pending_price_ars = null,
            pending_effective_at = null,
            updated_at = now()
      where id = 1
        and pending_effective_at is not null
        and pending_effective_at <= now()
      returning subscription_price_ars`,
  );
  const row = r.rows[0];
  if (!row) return { promoted: false };
  return { promoted: true, newPrice: row.subscription_price_ars };
}
