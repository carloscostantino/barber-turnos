import nodemailer from 'nodemailer';
import { env, isSmtpConfigured } from './env';

export function createMailer(): nodemailer.Transporter | null {
  if (!isSmtpConfigured()) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export type ReminderPayload = {
  to: string;
  customerName: string;
  serviceName: string;
  startsAtLabel: string;
  /** Enlace para cancelar sin iniciar sesión (mismo token que en la confirmación). */
  cancelUrl?: string;
};

export async function sendAppointmentReminderEmail(
  transporter: nodemailer.Transporter,
  p: ReminderPayload,
): Promise<void> {
  const subject = `Recordatorio: turno el ${p.startsAtLabel}`;
  const cancelBlock = p.cancelUrl?.trim()
    ? [
        '',
        'Para cancelar este turno (sin iniciar sesión):',
        p.cancelUrl.trim(),
      ]
    : [];
  const cancelHtml = p.cancelUrl?.trim()
    ? `<p style="margin-top:12px"><a href="${escapeHtml(p.cancelUrl.trim())}">Cancelar turno</a></p>`
    : '';

  const text = [
    `Hola ${p.customerName},`,
    '',
    `Te recordamos tu turno el ${p.startsAtLabel}.`,
    `Servicio: ${p.serviceName}`,
    ...cancelBlock,
    '',
    'Si necesitás cambiar el horario, contactá al local.',
  ].join('\n');

  const html = `
    <p>Hola ${escapeHtml(p.customerName)},</p>
    <p>Te recordamos tu turno el <strong>${escapeHtml(p.startsAtLabel)}</strong>.</p>
    <ul>
      <li>Servicio: ${escapeHtml(p.serviceName)}</li>
    </ul>
    ${cancelHtml}
    <p style="color:#666;font-size:12px">Si necesitás otro cambio, contactá al local.</p>
  `.trim();

  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}

export async function sendAppointmentCancelledEmail(
  transporter: nodemailer.Transporter,
  p: {
    to: string;
    customerName: string;
    serviceName: string;
    startsAtLabel: string;
    cancellationNote?: string;
  },
): Promise<void> {
  const noteBlock = p.cancellationNote?.trim()
    ? [
        '',
        'Mensaje del local:',
        p.cancellationNote.trim(),
      ]
    : [];
  const noteHtml = p.cancellationNote?.trim()
    ? `<p style="margin-top:12px;padding:10px 12px;background:#f5f5f5;border-radius:6px;border-left:3px solid #888">${escapeHtml(p.cancellationNote.trim()).replace(/\n/g, '<br/>')}</p>`
    : '';

  const subject = `Turno cancelado — ${p.startsAtLabel}`;
  const text = [
    `Hola ${p.customerName},`,
    '',
    `Tu turno quedó cancelado: ${p.serviceName}, ${p.startsAtLabel}.`,
    ...noteBlock,
    '',
    'Si no pediste esta cancelación, contactá al local.',
  ].join('\n');
  const html = `
    <p>Hola ${escapeHtml(p.customerName)},</p>
    <p>Tu turno quedó <strong>cancelado</strong>: ${escapeHtml(p.serviceName)}, ${escapeHtml(p.startsAtLabel)}.</p>
    ${noteHtml}
    <p style="color:#666;font-size:12px">Si no pediste esta cancelación, contactá al local.</p>
  `.trim();
  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}

export function formatAppointmentDateTimeLabel(iso: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: env.TIMEZONE,
  }).format(iso);
}

/**
 * Formato `$4.999` (sin decimales, moneda ARS) usado en los emails de cambio
 * de precio de suscripción.
 */
export function formatArsCurrency(amountArs: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountArs);
}

/**
 * Formato `15 de mayo de 2026` para la fecha efectiva de un cambio de precio.
 */
export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'long',
    timeZone: env.TIMEZONE,
  }).format(date);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendBookingConfirmationEmail(
  transporter: nodemailer.Transporter,
  p: {
    to: string;
    customerName: string;
    serviceName: string;
    startsAtLabel: string;
    cancelUrl: string;
  },
): Promise<void> {
  const subject = `Turno confirmado — ${p.startsAtLabel}`;
  const text = [
    `Hola ${p.customerName},`,
    '',
    `Tu turno quedó confirmado: ${p.serviceName}, ${p.startsAtLabel}.`,
    '',
    'Para cancelar cuando quieras (sin iniciar sesión):',
    p.cancelUrl,
    '',
    'Si no pediste este turno, ignorá este mensaje o contactá al local.',
  ].join('\n');
  const html = `
    <p>Hola ${escapeHtml(p.customerName)},</p>
    <p>Tu turno quedó <strong>confirmado</strong>: ${escapeHtml(p.serviceName)}, ${escapeHtml(p.startsAtLabel)}.</p>
    <p style="margin-top:12px"><a href="${escapeHtml(p.cancelUrl)}">Cancelar turno</a></p>
    <p style="color:#666;font-size:12px">Si no pediste este turno, ignorá este mensaje.</p>
  `.trim();
  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}

export async function sendSubscriptionPriceChangeEmail(
  transporter: nodemailer.Transporter,
  p: {
    to: string;
    shopName: string;
    oldPriceArs: number;
    newPriceArs: number;
    effectiveAt: Date;
  },
): Promise<void> {
  const oldPrice = formatArsCurrency(p.oldPriceArs);
  const newPrice = formatArsCurrency(p.newPriceArs);
  const effective = formatLongDate(p.effectiveAt);
  const subject = `Actualización del precio de tu suscripción a partir del ${effective}`;
  const text = [
    `Hola,`,
    '',
    `Te informamos que a partir del ${effective} el precio mensual de la suscripción de "${p.shopName}" pasa de ${oldPrice} a ${newPrice}.`,
    '',
    'El cambio se aplicará automáticamente en tu próximo cobro a partir de esa fecha. No necesitás hacer nada.',
    '',
    'Si preferís cancelar la suscripción antes, podés hacerlo desde el panel de tu barbería.',
  ].join('\n');
  const html = `
    <p>Hola,</p>
    <p>Te informamos que a partir del <strong>${escapeHtml(effective)}</strong> el precio mensual de la suscripción de <strong>${escapeHtml(p.shopName)}</strong> pasa de <strong>${escapeHtml(oldPrice)}</strong> a <strong>${escapeHtml(newPrice)}</strong>.</p>
    <p>El cambio se aplicará automáticamente en tu próximo cobro a partir de esa fecha. No necesitás hacer nada.</p>
    <p style="color:#666;font-size:12px">Si preferís cancelar la suscripción antes, podés hacerlo desde el panel de tu barbería.</p>
  `.trim();
  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}

export async function sendSubscriptionPriceChangeCancelledEmail(
  transporter: nodemailer.Transporter,
  p: {
    to: string;
    shopName: string;
    currentPriceArs: number;
    cancelledPriceArs: number;
    cancelledEffectiveAt: Date;
  },
): Promise<void> {
  const currentPrice = formatArsCurrency(p.currentPriceArs);
  const cancelledPrice = formatArsCurrency(p.cancelledPriceArs);
  const effective = formatLongDate(p.cancelledEffectiveAt);
  const subject = `Cambio de precio cancelado — tu suscripción mantiene ${currentPrice}`;
  const text = [
    `Hola,`,
    '',
    `Te avisamos que el cambio de precio que te habíamos comunicado para "${p.shopName}" (a ${cancelledPrice} desde el ${effective}) se canceló.`,
    '',
    `Tu suscripción seguirá en ${currentPrice} como hasta ahora.`,
  ].join('\n');
  const html = `
    <p>Hola,</p>
    <p>Te avisamos que el cambio de precio que te habíamos comunicado para <strong>${escapeHtml(p.shopName)}</strong> (a <strong>${escapeHtml(cancelledPrice)}</strong> desde el <strong>${escapeHtml(effective)}</strong>) se canceló.</p>
    <p>Tu suscripción seguirá en <strong>${escapeHtml(currentPrice)}</strong> como hasta ahora.</p>
  `.trim();
  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}
