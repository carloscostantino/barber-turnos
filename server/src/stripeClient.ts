import Stripe from 'stripe';
import { env } from './env';

export const STRIPE_API_VERSION = '2026-03-25.dahlia' as const;

type StripeInstance = InstanceType<typeof Stripe>;

/** Cliente para llamadas a la API (Customer, Checkout). Null sin `STRIPE_SECRET_KEY`. */
export function getStripe(): StripeInstance | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });
}

/**
 * Instancia mínima para `webhooks.constructEvent` (no usa la clave API en la verificación).
 */
export function getStripeForWebhooks(): StripeInstance {
  return new Stripe(env.STRIPE_SECRET_KEY ?? 'sk_test_00000000000000000000000000000000', {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });
}
