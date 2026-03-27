import { pool } from './db';
import { env, isSmtpConfigured } from './env';
import { createMailer, sendAppointmentReminderEmail } from './mailer';

type ReminderRow = {
  id: string;
  starts_at: Date;
  customer_email: string;
  customer_name: string;
  service_name: string;
};

let running = false;

function formatStartsAt(iso: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: env.TIMEZONE,
  }).format(iso);
}

async function fetchReminderCandidates(): Promise<ReminderRow[]> {
  const hours = env.REMINDER_HOURS_BEFORE;
  const result = await pool.query<ReminderRow>(
    `
    select
      a.id,
      a.starts_at,
      c.email as customer_email,
      c.name as customer_name,
      s.name as service_name
    from appointments a
    join customers c on c.id = a.customer_id
    join services s on s.id = a.service_id
    where a.reminder_email_sent_at is null
      and c.email is not null
      and trim(c.email) <> ''
      and a.status in ('pending', 'confirmed')
      and a.starts_at > now()
      and a.starts_at >= now() + interval '1 hour' * $1::double precision - interval '45 minutes'
      and a.starts_at <= now() + interval '1 hour' * $1::double precision + interval '45 minutes'
    order by a.starts_at asc
    `,
    [hours],
  );
  return result.rows;
}

async function markReminderSent(appointmentId: string): Promise<void> {
  await pool.query(
    `update appointments set reminder_email_sent_at = now() where id = $1`,
    [appointmentId],
  );
}

export async function runReminderJob(): Promise<void> {
  if (!isSmtpConfigured()) return;
  if (running) return;
  running = true;
  const transporter = createMailer();
  if (!transporter) {
    running = false;
    return;
  }

  try {
    const rows = await fetchReminderCandidates();
    for (const row of rows) {
      try {
        await sendAppointmentReminderEmail(transporter, {
          to: row.customer_email,
          customerName: row.customer_name,
          serviceName: row.service_name,
          startsAtLabel: formatStartsAt(row.starts_at),
        });
        await markReminderSent(row.id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[reminders] fallo envío para turno ${row.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startReminderScheduler(): void {
  if (!isSmtpConfigured()) {
    // eslint-disable-next-line no-console
    console.log('Recordatorios por email: deshabilitados (SMTP no configurado).');
    return;
  }

  const ms = env.REMINDER_POLL_MINUTES * 60 * 1000;
  // eslint-disable-next-line no-console
  console.log(
    `Recordatorios por email: activos (cada ${env.REMINDER_POLL_MINUTES} min, ${env.REMINDER_HOURS_BEFORE} h antes del turno).`,
  );

  void runReminderJob();
  setInterval(() => {
    void runReminderJob();
  }, ms);
}
