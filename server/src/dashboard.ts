import { DateTime } from 'luxon';
import { pool } from './db';
import { getShopById } from './shops';

/**
 * Métricas para el dashboard del panel admin:
 *   - Turnos y estimación de ingresos para tres ventanas: hoy, esta semana
 *     (lunes → domingo de la semana local) y este mes (1º → último día).
 *   - Ratio de asistencia sobre turnos pasados en los últimos 60 días
 *     (attended=true ÷ finalizados con starts_at ≤ now y status='confirmed').
 *   - Top 5 clientes recurrentes en los últimos 60 días por cantidad de
 *     turnos confirmados (incluye pasados con attended=true y futuros).
 *
 * Las ventanas se calculan en la zona horaria del shop para que "hoy"
 * respete el reloj local del negocio (Argentina) aun cuando el servidor
 * corra en UTC.
 */

export type DashboardWindow = {
  appointments: number;
  revenueCents: number;
};

export type DashboardData = {
  timezone: string;
  generatedAt: string;
  today: DashboardWindow;
  week: DashboardWindow;
  month: DashboardWindow;
  attendance: {
    /** Turnos pasados (últimos 60 días) en `confirmed`. */
    past: number;
    /** Cuántos de esos quedaron marcados `attended = true`. */
    attended: number;
    /** Porcentaje 0–100 (int). `null` si no hubo turnos pasados. */
    ratePct: number | null;
  };
  repeatCustomers: Array<{
    customerId: string;
    name: string;
    phone: string | null;
    email: string | null;
    totalAppointments: number;
    lastAppointmentAt: string;
  }>;
};

type CountSumRow = { appointments: string; revenue_cents: string };

async function windowMetrics(
  shopId: string,
  fromIso: string,
  toIso: string,
): Promise<DashboardWindow> {
  const r = await pool.query<CountSumRow>(
    `select
        count(a.id)::int8 as appointments,
        coalesce(sum(s.price_cents), 0)::int8 as revenue_cents
      from appointments a
      join services s on s.id = a.service_id
      where a.shop_id = $1
        and a.status = 'confirmed'
        and a.starts_at >= $2::timestamptz
        and a.starts_at < $3::timestamptz`,
    [shopId, fromIso, toIso],
  );
  const row = r.rows[0];
  return {
    appointments: Number(row?.appointments ?? 0),
    revenueCents: Number(row?.revenue_cents ?? 0),
  };
}

export async function getDashboardData(shopId: string): Promise<DashboardData> {
  const shop = await getShopById(shopId);
  const zone = shop?.timezone ?? 'America/Argentina/Buenos_Aires';

  const now = DateTime.now().setZone(zone);
  const todayStart = now.startOf('day');
  const todayEnd = todayStart.plus({ days: 1 });

  const weekStart = now.startOf('week'); // luxon: lunes 00:00 local
  const weekEnd = weekStart.plus({ weeks: 1 });

  const monthStart = now.startOf('month');
  const monthEnd = monthStart.plus({ months: 1 });

  const [today, week, month] = await Promise.all([
    windowMetrics(shopId, todayStart.toISO()!, todayEnd.toISO()!),
    windowMetrics(shopId, weekStart.toISO()!, weekEnd.toISO()!),
    windowMetrics(shopId, monthStart.toISO()!, monthEnd.toISO()!),
  ]);

  // Asistencia: de los últimos 60 días, cuántos `confirmed` y pasados
  // quedaron `attended = true`. Limitamos a `confirmed` porque los
  // cancelados ya no reflejan "asistencia".
  const sixtyDaysAgo = now.minus({ days: 60 }).toISO()!;
  const attendanceRes = await pool.query<{
    past: string;
    attended: string;
  }>(
    `select
        count(*)::int8 as past,
        sum(case when attended then 1 else 0 end)::int8 as attended
      from appointments
      where shop_id = $1
        and status = 'confirmed'
        and starts_at >= $2::timestamptz
        and starts_at < now()`,
    [shopId, sixtyDaysAgo],
  );
  const past = Number(attendanceRes.rows[0]?.past ?? 0);
  const attended = Number(attendanceRes.rows[0]?.attended ?? 0);
  const attendance = {
    past,
    attended,
    ratePct: past > 0 ? Math.round((attended / past) * 100) : null,
  };

  // Top 5 clientes recurrentes en los últimos 60 días (incluye futuros).
  const repeatRes = await pool.query<{
    customer_id: string;
    name: string;
    phone: string | null;
    email: string | null;
    total: string;
    last_at: Date;
  }>(
    `select
        c.id as customer_id,
        c.name,
        c.phone,
        c.email,
        count(a.id)::int8 as total,
        max(a.starts_at) as last_at
      from appointments a
      join customers c on c.id = a.customer_id
      where a.shop_id = $1
        and a.status = 'confirmed'
        and a.starts_at >= $2::timestamptz
      group by c.id, c.name, c.phone, c.email
      having count(a.id) >= 2
      order by total desc, last_at desc
      limit 5`,
    [shopId, sixtyDaysAgo],
  );

  return {
    timezone: zone,
    generatedAt: now.toISO()!,
    today,
    week,
    month,
    attendance,
    repeatCustomers: repeatRes.rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      totalAppointments: Number(r.total),
      lastAppointmentAt: r.last_at.toISOString(),
    })),
  };
}
