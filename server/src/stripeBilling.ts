import { pool } from './db';
import { env } from './env';
import { getStripe } from './stripeClient';

/**
 * Tras crear el shop: Customer en Stripe con `metadata.shop_id`, opcionalmente Checkout
 * de suscripción si existe `STRIPE_PRICE_ID` (conecta con webhooks vía metadata en la suscripción).
 */
export async function stripeOnboardingAfterRegistration(input: {
  shopId: string;
  slug: string;
  shopName: string;
  ownerEmail: string;
}): Promise<{ checkoutUrl: string | null }> {
  const stripe = getStripe();
  if (!stripe) {
    return { checkoutUrl: null };
  }

  try {
    const customer = await stripe.customers.create({
      email: input.ownerEmail,
      name: input.shopName,
      metadata: { shop_id: input.shopId },
    });

    await pool.query(
      `
      update shop_subscriptions
      set provider = 'stripe',
          external_customer_id = $2,
          updated_at = now()
      where shop_id = $1
      `,
      [input.shopId, customer.id],
    );

    const priceId = env.STRIPE_PRICE_ID?.trim();
    if (!priceId) {
      return { checkoutUrl: null };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.CLIENT_ORIGIN}/s/${encodeURIComponent(input.slug)}/admin?billing=success`,
      cancel_url: `${env.CLIENT_ORIGIN}/register`,
      subscription_data: {
        metadata: { shop_id: input.shopId },
      },
      metadata: { shop_id: input.shopId },
    });

    return { checkoutUrl: session.url };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[stripe onboarding]', e instanceof Error ? e.message : e);
    return { checkoutUrl: null };
  }
}
