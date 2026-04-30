import { pool } from './db';
import { env, isMpConfigured } from './env';
import { getPreApprovalClient } from './mercadopagoClient';
import { getPlatformSettings } from './platformSettings';
import { getShopById } from './shops';

/**
 * El SDK de MP lanza el JSON de error HTTP como objeto plano, no como Error.
 * Sin esto el catch del route solo muestra el mensaje genérico.
 */
/**
 * URL de retorno post-checkout en MP (`back_url`). MP a menudo rechaza
 * `http://localhost:...`; usá `MP_REDIRECT_BASE_URL` con HTTPS (ngrok al puerto 5173).
 */
function buildMpBackUrl(shopSlug: string): string {
  const base =
    env.MP_REDIRECT_BASE_URL?.trim().replace(/\/$/, '') ??
    env.CLIENT_ORIGIN.trim().replace(/\/$/, '');
  const u = new URL(
    `/s/${encodeURIComponent(shopSlug.trim())}/admin`,
    base.endsWith('/') ? base.slice(0, -1) : base,
  );
  u.searchParams.set('billing', 'success');
  return u.href;
}

/** MP rechaza localhost en `back_url`; fallamos antes con un mensaje accionable. */
function assertMpBackUrlAcceptedByMercadoPago(backUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(backUrl);
  } catch {
    throw new Error(
      'La URL de retorno tras el pago no es válida. Revisá MP_REDIRECT_BASE_URL o CLIENT_ORIGIN en el servidor.',
    );
  }
  const h = parsed.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
    throw new Error(
      'Mercado Pago no acepta localhost en back_url. En el .env de la raíz del repo definí MP_REDIRECT_BASE_URL con la URL https pública del frontend (la misma con la que abrís el panel, p. ej. ngrok al puerto 5173), sin barra final. Reiniciá el contenedor o proceso del API.',
    );
  }
}

export function formatMpCaughtError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (Array.isArray(o.cause)) {
      const parts: string[] = [];
      for (const c of o.cause) {
        if (c && typeof c === 'object') {
          const cc = c as Record<string, unknown>;
          if (typeof cc.description === 'string') parts.push(cc.description);
          else if (typeof cc.code === 'string') parts.push(String(cc.code));
        }
      }
      if (parts.length) return parts.join('; ');
    }
    try {
      return JSON.stringify(o);
    } catch {
      /* ignore */
    }
  }
  return 'Error al comunicar con Mercado Pago (revisá logs del servidor).';
}

export type SubscriptionRow = {
  shopId: string;
  provider: 'none' | 'stripe' | 'mercadopago';
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  initPoint: string | null;
};

type DbRow = {
  shop_id: string;
  provider: string;
  status: string;
  external_customer_id: string | null;
  external_subscription_id: string | null;
  current_period_end: Date | null;
  init_point: string | null;
};

function map(row: DbRow): SubscriptionRow {
  return {
    shopId: row.shop_id,
    provider: row.provider as SubscriptionRow['provider'],
    status: row.status as SubscriptionRow['status'],
    externalCustomerId: row.external_customer_id,
    externalSubscriptionId: row.external_subscription_id,
    currentPeriodEnd: row.current_period_end
      ? row.current_period_end.toISOString()
      : null,
    initPoint: row.init_point ?? null,
  };
}

/**
 * Asegura que la tabla `shop_subscriptions` tenga la columna `init_point`
 * disponible para guardar el link de pago. La migración
 * `018_shop_subscriptions_init_point.js` la agrega formalmente.
 */

export async function getSubscriptionForShop(
  shopId: string,
): Promise<SubscriptionRow | null> {
  const r = await pool.query<DbRow>(
    `select shop_id, provider, status, external_customer_id,
            external_subscription_id, current_period_end, init_point
       from shop_subscriptions where shop_id = $1 limit 1`,
    [shopId],
  );
  const row = r.rows[0];
  return row ? map(row) : null;
}

async function upsertSubscription(data: {
  shopId: string;
  provider: 'none' | 'mercadopago' | 'stripe';
  status: string;
  externalSubscriptionId?: string | null;
  externalCustomerId?: string | null;
  currentPeriodEnd?: Date | null;
  initPoint?: string | null;
}): Promise<SubscriptionRow> {
  const r = await pool.query<DbRow>(
    `insert into shop_subscriptions
       (shop_id, provider, status, external_subscription_id, external_customer_id,
        current_period_end, init_point, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (shop_id) do update set
       provider = excluded.provider,
       status = excluded.status,
       external_subscription_id = coalesce(excluded.external_subscription_id, shop_subscriptions.external_subscription_id),
       external_customer_id = coalesce(excluded.external_customer_id, shop_subscriptions.external_customer_id),
       current_period_end = coalesce(excluded.current_period_end, shop_subscriptions.current_period_end),
       init_point = coalesce(excluded.init_point, shop_subscriptions.init_point),
       updated_at = now()
     returning shop_id, provider, status, external_customer_id,
               external_subscription_id, current_period_end, init_point`,
    [
      data.shopId,
      data.provider,
      data.status,
      data.externalSubscriptionId ?? null,
      data.externalCustomerId ?? null,
      data.currentPeriodEnd ?? null,
      data.initPoint ?? null,
    ],
  );
  return map(r.rows[0]!);
}

/** Email del owner original de un shop (primer shop_user con role=owner). */
async function getOwnerEmail(shopId: string): Promise<string | null> {
  const r = await pool.query<{ email: string }>(
    `select email from shop_users
      where shop_id = $1 and role = 'owner'
      order by created_at asc limit 1`,
    [shopId],
  );
  return r.rows[0]?.email ?? null;
}

export type PreapprovalStatus = 'authorized' | 'paused' | 'cancelled' | 'pending';

export type RawPreapproval = {
  id: string;
  status: PreapprovalStatus;
  init_point?: string;
  next_payment_date?: string | null;
  payer_email?: string;
  external_reference?: string;
};

/**
 * Consulta el estado de un preapproval. Si `MP_MOCK_PREAPPROVAL_STATUS` está
 * definido, devuelve una respuesta simulada sin llamar a MP (usado en E2E).
 */
export async function getPreapprovalStatus(
  preapprovalId: string,
): Promise<RawPreapproval | null> {
  // Leemos process.env en runtime (no env.*) para que los tests E2E puedan
  // cambiar el mock dinámicamente vía el endpoint /system/e2e/mp-mock.
  const rawMock = process.env.MP_MOCK_PREAPPROVAL_STATUS?.trim();
  const allowed: PreapprovalStatus[] = ['authorized', 'paused', 'cancelled', 'pending'];
  const mock =
    rawMock && (allowed as string[]).includes(rawMock)
      ? (rawMock as PreapprovalStatus)
      : null;
  if (mock) {
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 30);
    return {
      id: preapprovalId,
      status: mock,
      next_payment_date: next.toISOString(),
    };
  }
  const client = getPreApprovalClient();
  if (!client) return null;
  try {
    const resp = await client.get({ id: preapprovalId });
    if (!resp.id || !resp.status) return null;
    return {
      id: resp.id,
      status: resp.status as PreapprovalStatus,
      init_point: resp.init_point,
      next_payment_date: resp.next_payment_date ?? null,
      payer_email: resp.payer_email,
      external_reference: resp.external_reference,
    };
  } catch {
    return null;
  }
}

/**
 * Crea o reutiliza un preapproval para la shop y devuelve el `init_point`
 * para redirigir al owner al flujo de tarjeta de MP.
 *
 * - Si ya hay un preapproval en estado `pending` o `authorized`, reusa el
 *   init_point guardado (MP no genera uno nuevo en updates).
 * - Si hubiera uno cancelado/paused, crea otro.
 */
export async function createOrGetPreapprovalForShop(
  shopId: string,
): Promise<{ initPoint: string; preapprovalId: string } | null> {
  if (!isMpConfigured()) return null;

  const shop = await getShopById(shopId);
  if (!shop) return null;
  const ownerEmail = await getOwnerEmail(shopId);

  const current = await getSubscriptionForShop(shopId);
  if (
    current &&
    current.provider === 'mercadopago' &&
    current.externalSubscriptionId &&
    current.initPoint
  ) {
    const raw = await getPreapprovalStatus(current.externalSubscriptionId);
    if (raw && (raw.status === 'authorized' || raw.status === 'pending')) {
      return {
        initPoint: current.initPoint,
        preapprovalId: current.externalSubscriptionId,
      };
    }
  }

  // Modo E2E: si `MP_MOCK_PREAPPROVAL_STATUS` está definido, no llamamos al
  // SDK real; generamos un preapproval simulado para poder probar el flujo
  // completo sin credenciales productivas.
  const isMockMode = Boolean(process.env.MP_MOCK_PREAPPROVAL_STATUS?.trim());
  if (isMockMode) {
    const preapprovalId = `MP-E2E-${shopId}`;
    const initPoint = buildMpBackUrl(shop.slug);
    await upsertSubscription({
      shopId,
      provider: 'mercadopago',
      status: 'none',
      externalSubscriptionId: preapprovalId,
      initPoint,
    });
    return { initPoint, preapprovalId };
  }

  // Fuera de E2E: si no hay email del owner no podemos crear el preapproval
  // real (MP lo requiere).
  if (!ownerEmail) return null;

  const client = getPreApprovalClient();
  if (!client) return null;

  const backUrl = buildMpBackUrl(shop.slug);
  assertMpBackUrlAcceptedByMercadoPago(backUrl);

  const platform = await getPlatformSettings();

  const resp = await client.create({
    body: {
      reason: platform.current.subscriptionReason,
      external_reference: shopId,
      payer_email: ownerEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: platform.current.subscriptionPriceArs,
        currency_id: 'ARS',
      },
      status: 'pending',
    },
  });

  if (!resp.id || !resp.init_point) {
    throw new Error('Mercado Pago no devolvió preapproval válido');
  }

  await upsertSubscription({
    shopId,
    provider: 'mercadopago',
    status: 'none',
    externalSubscriptionId: resp.id,
    initPoint: resp.init_point,
  });

  return { initPoint: resp.init_point, preapprovalId: resp.id };
}

/**
 * Cancela el preapproval actual en MP y marca la suscripción como cancelada
 * localmente. MP igualmente enviará un webhook de confirmación.
 */
export async function cancelPreapprovalForShop(
  shopId: string,
): Promise<boolean> {
  const current = await getSubscriptionForShop(shopId);
  if (!current || !current.externalSubscriptionId) return false;
  if (current.provider !== 'mercadopago') return false;

  const client = getPreApprovalClient();
  if (client && !process.env.MP_MOCK_PREAPPROVAL_STATUS?.trim()) {
    try {
      await client.update({
        id: current.externalSubscriptionId,
        body: { status: 'cancelled' },
      });
    } catch {
      /* MP puede rechazar si ya estaba cancelada: seguimos y marcamos local */
    }
  }

  await upsertSubscription({
    shopId,
    provider: 'mercadopago',
    status: 'canceled',
    externalSubscriptionId: current.externalSubscriptionId,
    initPoint: current.initPoint,
  });

  return true;
}

/**
 * Aplica el estado devuelto por MP (webhook o llamada directa) a la shop:
 * actualiza `shop_subscriptions` y `shops.status` en una transacción.
 */
export async function applyMpPreapprovalState(
  shopId: string,
  raw: RawPreapproval,
): Promise<void> {
  let subStatus: SubscriptionRow['status'];
  let shopStatus: 'active' | 'suspended' | null;

  switch (raw.status) {
    case 'authorized':
      subStatus = 'active';
      shopStatus = 'active';
      break;
    case 'paused':
      subStatus = 'paused';
      shopStatus = 'suspended';
      break;
    case 'cancelled':
      subStatus = 'canceled';
      shopStatus = 'suspended';
      break;
    case 'pending':
    default:
      subStatus = 'none';
      shopStatus = null;
      break;
  }

  const currentPeriodEnd =
    raw.next_payment_date && raw.status === 'authorized'
      ? new Date(raw.next_payment_date)
      : null;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('begin');
    await dbClient.query(
      `insert into shop_subscriptions
         (shop_id, provider, status, external_subscription_id,
          current_period_end, updated_at)
       values ($1, 'mercadopago', $2, $3, $4, now())
       on conflict (shop_id) do update set
         provider = 'mercadopago',
         status = excluded.status,
         external_subscription_id = coalesce(excluded.external_subscription_id, shop_subscriptions.external_subscription_id),
         current_period_end = coalesce(excluded.current_period_end, shop_subscriptions.current_period_end),
         updated_at = now()`,
      [shopId, subStatus, raw.id, currentPeriodEnd],
    );
    if (shopStatus) {
      await dbClient.query(`update shops set status = $2 where id = $1`, [
        shopId,
        shopStatus,
      ]);
    }
    await dbClient.query('commit');
  } catch (e) {
    await dbClient.query('rollback');
    throw e;
  } finally {
    dbClient.release();
  }
}

const MP_UPDATE_THROTTLE_MS = 150;

/**
 * Llama a MP por cada suscripción activa para actualizar el `transaction_amount`
 * al nuevo precio. Se ejecuta desde el `priceChangeJob` cuando un cambio
 * programado se vuelve efectivo. MP aplica el nuevo monto al siguiente cobro.
 *
 * Incluye throttle para evitar rate limit cuando hay muchas shops. En modo mock
 * (E2E) no llama a MP real pero igual devuelve los conteos para loggear.
 */
export async function applyPriceChangeToAllActiveShops(
  newPriceArs: number,
): Promise<{ updated: number; failed: number }> {
  const r = await pool.query<{
    shop_id: string;
    external_subscription_id: string;
  }>(
    `select shop_id, external_subscription_id
       from shop_subscriptions
      where provider = 'mercadopago'
        and external_subscription_id is not null
        and status in ('active', 'trialing', 'paused')`,
  );

  const rows = r.rows;
  const isMockMode = Boolean(process.env.MP_MOCK_PREAPPROVAL_STATUS?.trim());
  if (isMockMode) {
    // eslint-disable-next-line no-console
    console.log(
      `[mp] applyPriceChange mock: ${rows.length} shop(s) se habrían actualizado a ${newPriceArs} ARS`,
    );
    return { updated: rows.length, failed: 0 };
  }

  const client = getPreApprovalClient();
  if (!client) {
    // eslint-disable-next-line no-console
    console.warn(
      '[mp] applyPriceChange: cliente MP no disponible; se omite sync',
    );
    return { updated: 0, failed: rows.length };
  }

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await client.update({
        id: row.external_subscription_id,
        body: {
          auto_recurring: {
            transaction_amount: newPriceArs,
            currency_id: 'ARS',
          },
        },
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(
        `[mp] applyPriceChange fallo shop=${row.shop_id} preapproval=${row.external_subscription_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, MP_UPDATE_THROTTLE_MS));
  }
  return { updated, failed };
}
