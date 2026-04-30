import { applyPriceChangeToAllActiveShops } from './mercadopagoBilling';
import { promotePendingPriceIfDue } from './platformSettings';

/**
 * Job que activa cambios de precio programados. Si la ventana venció, pasa
 * `pending_price_ars` a `subscription_price_ars` y dispara el update en MP
 * para todas las suscripciones activas. Si no hay nada pendiente, no hace
 * nada (barato de correr).
 *
 * Guard contra solapes en caso de que la llamada a MP sea lenta y el
 * scheduler dispare antes de que termine la anterior.
 */
const PRICE_CHANGE_JOB_HOURS = 1;

let running = false;

export async function runPriceChangeJob(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await promotePendingPriceIfDue();
    if (!result.promoted) return;
    // eslint-disable-next-line no-console
    console.log(
      `[priceChangeJob] promoviendo precio a ${result.newPrice} ARS; actualizando MP...`,
    );
    const sync = await applyPriceChangeToAllActiveShops(result.newPrice);
    // eslint-disable-next-line no-console
    console.log(
      `[priceChangeJob] sync MP completo: updated=${sync.updated} failed=${sync.failed}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[priceChangeJob] error:',
      err instanceof Error ? err.message : err,
    );
  } finally {
    running = false;
  }
}

export function startPriceChangeScheduler(): void {
  const ms = PRICE_CHANGE_JOB_HOURS * 60 * 60 * 1000;
  // eslint-disable-next-line no-console
  console.log(
    `Cambios de precio: job cada ${PRICE_CHANGE_JOB_HOURS} h (aplica pendientes vencidos).`,
  );
  void runPriceChangeJob();
  setInterval(() => {
    void runPriceChangeJob();
  }, ms);
}
