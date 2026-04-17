import type { Request, Response } from 'express';
import { pool } from './db';
import { env } from './env';
import { getStripeForWebhooks } from './stripeClient';

type StripeSubscriptionPayload = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  metadata: { shop_id?: string | null } | null;
  current_period_end: number | null;
};

/** Tipo mínimo del evento devuelto por `constructEvent` (evita conflicto tipos del export default de Stripe). */
type StripeWebhookEvent = {
  type: string;
  data: { object: StripeSubscriptionPayload };
};

function mapStripeSubStatus(
  s: string,
): 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'none' {
  switch (s) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'unpaid':
      return s;
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'none';
    default:
      return 'none';
  }
}

function shopStatusFromSubscription(
  dbStatus: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'none',
): 'trial' | 'active' | 'suspended' {
  if (dbStatus === 'trialing') return 'trial';
  if (dbStatus === 'active') return 'active';
  return 'suspended';
}

async function applySubscriptionToShop(
  shopId: string,
  sub: StripeSubscriptionPayload,
): Promise<void> {
  const dbStatus = mapStripeSubStatus(sub.status);
  const cust = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const periodEnd =
    sub.current_period_end != null ? new Date(sub.current_period_end * 1000) : null;
  const shopRowStatus = shopStatusFromSubscription(dbStatus);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
      insert into shop_subscriptions (
        shop_id, provider, external_customer_id, external_subscription_id,
        status, current_period_end, updated_at
      )
      values ($1, 'stripe', $2, $3, $4, $5, now())
      on conflict (shop_id) do update set
        provider = 'stripe',
        external_customer_id = coalesce(excluded.external_customer_id, shop_subscriptions.external_customer_id),
        external_subscription_id = excluded.external_subscription_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
      `,
      [shopId, cust, sub.id, dbStatus, periodEnd],
    );
    await client.query(`update shops set status = $1 where id = $2`, [
      shopRowStatus,
      shopId,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function markShopSuspended(shopId: string): Promise<void> {
  await pool.query(
    `
    update shop_subscriptions
    set status = 'canceled', updated_at = now()
    where shop_id = $1
    `,
    [shopId],
  );
  await pool.query(`update shops set status = 'suspended' where id = $1`, [shopId]);
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    res.status(501).json({ error: 'Stripe no configurado' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string') {
    res.status(400).send('Falta Stripe-Signature');
    return;
  }

  const raw = req.body as Buffer | string;
  const payload = typeof raw === 'string' ? Buffer.from(raw) : raw;

  let event: StripeWebhookEvent;
  try {
    event = getStripeForWebhooks().webhooks.constructEvent(
      payload,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    ) as unknown as StripeWebhookEvent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`Webhook: ${msg}`);
    return;
  }

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as StripeSubscriptionPayload;
        const shopId = sub.metadata?.shop_id?.trim();
        if (shopId) {
          await applySubscriptionToShop(shopId, sub);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeSubscriptionPayload;
        const shopId = sub.metadata?.shop_id?.trim();
        if (shopId) {
          await markShopSuspended(shopId);
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[stripe webhook]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'error al aplicar evento' });
  }
}
