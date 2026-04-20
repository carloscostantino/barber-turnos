import { pool } from './db';
import { env, isSmtpConfigured } from './env';
import { createMailer } from './mailer';
import nodemailer from 'nodemailer';

/**
 * Job periódico que:
 *  1) marca como `suspended` los shops con `status='trial'` y `trial_ends_at` vencido,
 *  2) envía un aviso por email al owner cuando quedan ≤ `TRIAL_WARNING_DAYS` días
 *     para el vencimiento (una sola vez, usando `trial_warning_sent_at`).
 *
 * El envío de email es best-effort: si SMTP no está configurado, el paso (2) se omite
 * pero (1) sigue ejecutándose. El scheduler se lanza desde `index.ts`.
 */

let running = false;

type ExpiredShop = { id: string; slug: string; name: string };

type WarnShopRow = {
  id: string;
  slug: string;
  name: string;
  owner_email: string;
  trial_ends_at: Date;
};

async function suspendExpiredTrials(): Promise<ExpiredShop[]> {
  const r = await pool.query<ExpiredShop>(
    `update shops
       set status = 'suspended'
     where status = 'trial'
       and trial_ends_at is not null
       and trial_ends_at <= now()
     returning id, slug, name`,
  );
  return r.rows;
}

async function fetchWarnCandidates(): Promise<WarnShopRow[]> {
  const r = await pool.query<WarnShopRow>(
    `select
        s.id,
        s.slug,
        s.name,
        s.trial_ends_at,
        (
          select email
            from shop_users su
            where su.shop_id = s.id and su.role = 'owner'
            order by su.created_at asc
            limit 1
        ) as owner_email
      from shops s
      where s.status = 'trial'
        and s.trial_ends_at is not null
        and s.trial_warning_sent_at is null
        and s.trial_ends_at > now()
        and s.trial_ends_at <= now() + interval '1 day' * $1::double precision`,
    [env.TRIAL_WARNING_DAYS],
  );
  return r.rows.filter((row) => row.owner_email && row.owner_email.trim().length > 0);
}

async function markWarned(shopId: string): Promise<void> {
  await pool.query(
    `update shops set trial_warning_sent_at = now() where id = $1`,
    [shopId],
  );
}

function daysLeft(trialEndsAt: Date): number {
  const ms = trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

async function sendTrialWarningEmail(
  transporter: nodemailer.Transporter,
  p: { to: string; shopName: string; slug: string; days: number },
): Promise<void> {
  const subject = `Tu período de prueba termina en ${p.days} día${p.days === 1 ? '' : 's'}`;
  const adminUrl = `${env.CLIENT_ORIGIN}/s/${p.slug}/admin`;
  const text = [
    `Hola,`,
    '',
    `Tu período de prueba para "${p.shopName}" termina en ${p.days} día${p.days === 1 ? '' : 's'}.`,
    'Cuando se venza, el local quedará suspendido y las nuevas reservas se pausarán hasta activar una suscripción.',
    '',
    `Panel de administración: ${adminUrl}`,
  ].join('\n');
  const html = `
    <p>Hola,</p>
    <p>Tu período de prueba para <strong>${p.shopName}</strong> termina en <strong>${p.days} día${p.days === 1 ? '' : 's'}</strong>.</p>
    <p>Cuando se venza, el local quedará suspendido y las nuevas reservas se pausarán hasta activar una suscripción.</p>
    <p style="margin-top:12px"><a href="${adminUrl}">Ir al panel</a></p>
  `.trim();
  await transporter.sendMail({
    from: env.MAIL_FROM!,
    to: p.to,
    subject,
    text,
    html,
  });
}

export async function runTrialJob(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const suspended = await suspendExpiredTrials();
    if (suspended.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[trialJob] ${suspended.length} shop(s) suspendidos por trial vencido:`,
        suspended.map((s) => s.slug).join(', '),
      );
    }

    if (!isSmtpConfigured()) return;
    const transporter = createMailer();
    if (!transporter) return;

    const rows = await fetchWarnCandidates();
    for (const row of rows) {
      try {
        await sendTrialWarningEmail(transporter, {
          to: row.owner_email,
          shopName: row.name,
          slug: row.slug,
          days: daysLeft(row.trial_ends_at),
        });
        await markWarned(row.id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[trialJob] fallo aviso a ${row.slug}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startTrialScheduler(): void {
  const ms = env.TRIAL_JOB_HOURS * 60 * 60 * 1000;
  // eslint-disable-next-line no-console
  console.log(
    `Trials: job cada ${env.TRIAL_JOB_HOURS} h (aviso con ${env.TRIAL_WARNING_DAYS} día(s) de anticipación).`,
  );
  void runTrialJob();
  setInterval(() => {
    void runTrialJob();
  }, ms);
}
