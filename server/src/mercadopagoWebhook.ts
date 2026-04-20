import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { env } from './env';
import {
  applyMpPreapprovalState,
  getPreapprovalStatus,
} from './mercadopagoBilling';
import { pool } from './db';

/**
 * Valida la firma HMAC que MP envía en `x-signature`.
 *
 * Template documentado por MP:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Firmado con HMAC-SHA256 contra `MP_WEBHOOK_SECRET`, comparado con el campo
 * `v1` del header `x-signature: ts=<epoch>,v1=<hex>`.
 */
function verifyMpSignature(req: Request, dataId: string): boolean {
  if (!env.MP_WEBHOOK_SECRET) return false;

  const sigHeader = req.header('x-signature');
  const requestId = req.header('x-request-id');
  if (!sigHeader || !requestId) return false;

  const parts = sigHeader.split(',').map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('ts='))?.slice(3);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!ts || !v1) return false;

  const template = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', env.MP_WEBHOOK_SECRET)
    .update(template)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Dado un `preapproval.id`, busca el shop asociado (por
 * `external_subscription_id` o por `external_reference`) y aplica el nuevo
 * estado.
 */
async function handlePreapprovalNotification(preapprovalId: string): Promise<void> {
  const raw = await getPreapprovalStatus(preapprovalId);
  if (!raw) return;

  let shopId: string | null = null;

  const byExt = await pool.query<{ shop_id: string }>(
    `select shop_id from shop_subscriptions
      where external_subscription_id = $1 limit 1`,
    [preapprovalId],
  );
  if (byExt.rows[0]) {
    shopId = byExt.rows[0].shop_id;
  } else if (raw.external_reference) {
    const byShop = await pool.query<{ id: string }>(
      `select id from shops where id = $1 limit 1`,
      [raw.external_reference],
    );
    if (byShop.rows[0]) shopId = byShop.rows[0].id;
  }

  if (!shopId) return;
  await applyMpPreapprovalState(shopId, raw);
}

/**
 * Handler del webhook de Mercado Pago para `preapproval` y
 * `authorized_payment`. Devuelve 200 siempre que la firma sea válida para
 * evitar reintentos infinitos; los errores transitorios se registran y se
 * reponen en la próxima notificación.
 */
export async function handleMpWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  } | null;

  const dataId =
    body?.data?.id !== undefined && body.data.id !== null
      ? String(body.data.id)
      : '';

  if (!dataId) {
    // Notificaciones sin data.id no pueden validarse: no hay firma reproducible.
    res.status(400).json({ error: 'payload inválido' });
    return;
  }

  if (!verifyMpSignature(req, dataId)) {
    res.status(401).json({ error: 'firma inválida' });
    return;
  }

  const type = body?.type ?? body?.action ?? '';

  try {
    if (type.startsWith('preapproval')) {
      await handlePreapprovalNotification(dataId);
    } else if (type.startsWith('authorized_payment') || type === 'payment') {
      // El cobro genera un authorized_payment con su propio id, pero la fuente
      // de verdad para el estado del plan sigue siendo el preapproval: lo
      // resolvemos vía API si viniera anidado. En el flujo mínimo alcanza con
      // reconsultar por external_reference cuando ya exista.
      const byExt = await pool.query<{ external_subscription_id: string | null }>(
        `select external_subscription_id from shop_subscriptions
          where external_subscription_id = $1 limit 1`,
        [dataId],
      );
      const preId = byExt.rows[0]?.external_subscription_id ?? null;
      if (preId) await handlePreapprovalNotification(preId);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('mp webhook error', err);
    res.status(200).json({ ok: false });
  }
}
