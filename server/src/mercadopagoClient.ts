import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import { env } from './env';

/** Re-exporto para quien quiera el helper global. */
export { isMpConfigured } from './env';

let cachedConfig: MercadoPagoConfig | null = null;

/**
 * Devuelve un `MercadoPagoConfig` listo para usar o `null` si la integración
 * no está configurada (sin `MP_ACCESS_TOKEN`). Cachea la instancia.
 */
export function getMpConfig(): MercadoPagoConfig | null {
  if (!env.MP_ACCESS_TOKEN) return null;
  if (!cachedConfig) {
    cachedConfig = new MercadoPagoConfig({
      accessToken: env.MP_ACCESS_TOKEN,
    });
  }
  return cachedConfig;
}

/** Devuelve un cliente `PreApproval` o `null` si MP no está configurado. */
export function getPreApprovalClient(): PreApproval | null {
  const cfg = getMpConfig();
  if (!cfg) return null;
  return new PreApproval(cfg);
}
