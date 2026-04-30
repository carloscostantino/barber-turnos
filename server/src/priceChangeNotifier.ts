import { pool } from './db';
import { isSmtpConfigured } from './env';
import {
  createMailer,
  sendSubscriptionPriceChangeCancelledEmail,
  sendSubscriptionPriceChangeEmail,
} from './mailer';

type OwnerRow = {
  shop_name: string;
  owner_email: string;
};

/**
 * Devuelve el email del owner original y el nombre del shop para cada shop
 * con owner. Se excluyen shops sin `shop_users` o sin email configurado.
 * Limita el scope para que el envío masivo no caiga en owners "huérfanos".
 */
async function listAllOwnerEmails(): Promise<OwnerRow[]> {
  const r = await pool.query<OwnerRow>(
    `select
        s.name as shop_name,
        (
          select email
            from shop_users su
            where su.shop_id = s.id and su.role = 'owner'
            order by su.created_at asc
            limit 1
        ) as owner_email
      from shops s`,
  );
  return r.rows.filter(
    (row) => typeof row.owner_email === 'string' && row.owner_email.trim() !== '',
  );
}

/**
 * Envía el aviso de cambio de precio programado a todos los owners con email
 * configurado. Best-effort: si falla para uno, continúa con el resto.
 */
export async function sendPriceChangeEmailToAllOwners(args: {
  oldPriceArs: number;
  newPriceArs: number;
  effectiveAt: Date;
}): Promise<void> {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.log('[priceChange] SMTP no configurado: skip notificación');
    return;
  }
  const transporter = createMailer();
  if (!transporter) return;
  const owners = await listAllOwnerEmails();
  const results = await Promise.allSettled(
    owners.map((row) =>
      sendSubscriptionPriceChangeEmail(transporter, {
        to: row.owner_email,
        shopName: row.shop_name,
        oldPriceArs: args.oldPriceArs,
        newPriceArs: args.newPriceArs,
        effectiveAt: args.effectiveAt,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  // eslint-disable-next-line no-console
  console.log(
    `[priceChange] aviso enviado: total=${owners.length} fallos=${failed}`,
  );
}

/**
 * Envía el aviso de cancelación del cambio de precio programado a todos los
 * owners con email.
 */
export async function sendPriceChangeCancelledEmailToAllOwners(args: {
  currentPriceArs: number;
  cancelledPriceArs: number;
  cancelledEffectiveAt: Date;
}): Promise<void> {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.log(
      '[priceChange] SMTP no configurado: skip notificación de cancelación',
    );
    return;
  }
  const transporter = createMailer();
  if (!transporter) return;
  const owners = await listAllOwnerEmails();
  const results = await Promise.allSettled(
    owners.map((row) =>
      sendSubscriptionPriceChangeCancelledEmail(transporter, {
        to: row.owner_email,
        shopName: row.shop_name,
        currentPriceArs: args.currentPriceArs,
        cancelledPriceArs: args.cancelledPriceArs,
        cancelledEffectiveAt: args.cancelledEffectiveAt,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  // eslint-disable-next-line no-console
  console.log(
    `[priceChange] cancelación enviada: total=${owners.length} fallos=${failed}`,
  );
}
