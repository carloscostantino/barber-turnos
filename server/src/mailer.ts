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
};

export async function sendAppointmentReminderEmail(
  transporter: nodemailer.Transporter,
  p: ReminderPayload,
): Promise<void> {
  const subject = `Recordatorio: turno el ${p.startsAtLabel}`;
  const text = [
    `Hola ${p.customerName},`,
    '',
    `Te recordamos tu turno el ${p.startsAtLabel}.`,
    `Servicio: ${p.serviceName}`,
    '',
    'Si necesitás cambiar o cancelar, respondé a este correo o contactá al local.',
  ].join('\n');

  const html = `
    <p>Hola ${escapeHtml(p.customerName)},</p>
    <p>Te recordamos tu turno el <strong>${escapeHtml(p.startsAtLabel)}</strong>.</p>
    <ul>
      <li>Servicio: ${escapeHtml(p.serviceName)}</li>
    </ul>
    <p style="color:#666;font-size:12px">Si necesitás cambiar o cancelar, contactá al local.</p>
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
  p: { to: string; customerName: string; serviceName: string; startsAtLabel: string },
): Promise<void> {
  const subject = `Turno cancelado — ${p.startsAtLabel}`;
  const text = [
    `Hola ${p.customerName},`,
    '',
    `Tu turno quedó cancelado: ${p.serviceName}, ${p.startsAtLabel}.`,
    '',
    'Si no pediste esta cancelación, contactá al local.',
  ].join('\n');
  const html = `
    <p>Hola ${escapeHtml(p.customerName)},</p>
    <p>Tu turno quedó <strong>cancelado</strong>: ${escapeHtml(p.serviceName)}, ${escapeHtml(p.startsAtLabel)}.</p>
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
