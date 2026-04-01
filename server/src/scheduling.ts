import { DateTime } from 'luxon';
import { getService } from './api';
import { pool } from './db';
import { env } from './env';

export const SLOT_STEP_MINUTES = 15;

export type ShopSettingsRow = {
  bookingMinLeadHours: number;
  bookingMaxDaysAhead: number;
  shopName: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  contactAddress: string | null;
};

export async function getShopSettings(): Promise<ShopSettingsRow> {
  const r = await pool.query<{
    booking_min_lead_hours: number;
    booking_max_days_ahead: number;
    shop_name: string | null;
    contact_whatsapp: string | null;
    contact_email: string | null;
    contact_address: string | null;
  }>(
    `select booking_min_lead_hours, booking_max_days_ahead, shop_name, contact_whatsapp, contact_email, contact_address from shop_settings where id = 1`,
  );
  const row = r.rows[0];
  if (!row) throw new Error('shop_settings inexistente');
  return {
    bookingMinLeadHours: row.booking_min_lead_hours,
    bookingMaxDaysAhead: row.booking_max_days_ahead,
    shopName: row.shop_name,
    contactWhatsapp: row.contact_whatsapp,
    contactEmail: row.contact_email,
    contactAddress: row.contact_address,
  };
}

export async function updateShopSettings(data: {
  bookingMinLeadHours: number;
  bookingMaxDaysAhead: number;
  shopName?: string | null;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  contactAddress?: string | null;
}): Promise<ShopSettingsRow> {
  const current = await getShopSettings();
  const shopName = data.shopName !== undefined ? data.shopName : current.shopName;
  const contactWhatsapp =
    data.contactWhatsapp !== undefined ? data.contactWhatsapp : current.contactWhatsapp;
  const contactEmail = data.contactEmail !== undefined ? data.contactEmail : current.contactEmail;
  const contactAddress =
    data.contactAddress !== undefined ? data.contactAddress : current.contactAddress;

  const r = await pool.query<{
    booking_min_lead_hours: number;
    booking_max_days_ahead: number;
    shop_name: string | null;
    contact_whatsapp: string | null;
    contact_email: string | null;
    contact_address: string | null;
  }>(
    `update shop_settings set booking_min_lead_hours = $1, booking_max_days_ahead = $2, shop_name = $3, contact_whatsapp = $4, contact_email = $5, contact_address = $6 where id = 1
     returning booking_min_lead_hours, booking_max_days_ahead, shop_name, contact_whatsapp, contact_email, contact_address`,
    [
      data.bookingMinLeadHours,
      data.bookingMaxDaysAhead,
      shopName,
      contactWhatsapp,
      contactEmail,
      contactAddress,
    ],
  );
  const row = r.rows[0]!;
  return {
    bookingMinLeadHours: row.booking_min_lead_hours,
    bookingMaxDaysAhead: row.booking_max_days_ahead,
    shopName: row.shop_name,
    contactWhatsapp: row.contact_whatsapp,
    contactEmail: row.contact_email,
    contactAddress: row.contact_address,
  };
}

/** 0 = lunes … 6 = domingo (Luxon weekday 1–7 → 0–6). */
export function weekdayMon0FromDateStr(dateStr: string): number {
  const dt = DateTime.fromISO(dateStr, { zone: env.TIMEZONE });
  if (!dt.isValid) return 0;
  return dt.weekday - 1;
}

export async function getOpenCloseForDate(
  dateStr: string,
): Promise<{ open: DateTime; close: DateTime } | null> {
  const zone = env.TIMEZONE;
  const base = DateTime.fromISO(dateStr, { zone });
  if (!base.isValid) return null;
  const dow = base.weekday - 1;
  const r = await pool.query<{
    is_closed: boolean;
    open_time: string | null;
    close_time: string | null;
  }>(`select is_closed, open_time, close_time from business_hours where day_of_week = $1`, [
    dow,
  ]);
  const row = r.rows[0];
  if (!row || row.is_closed || !row.open_time || !row.close_time) return null;

  const [oh, om, os] = row.open_time.split(/[:.]/).map((x) => parseInt(x, 10));
  const [ch, cm, cs] = row.close_time.split(/[:.]/).map((x) => parseInt(x, 10));
  const open = base.set({
    hour: oh,
    minute: om ?? 0,
    second: os ?? 0,
    millisecond: 0,
  });
  const close = base.set({
    hour: ch,
    minute: cm ?? 0,
    second: cs ?? 0,
    millisecond: 0,
  });
  if (close <= open) return null;
  return { open, close };
}

/** Inicio (inclusivo) y fin (exclusivo) del día calendario en la zona del negocio. */
export function blockedRangeForShopCalendarDay(dateYmd: string): {
  startsAt: Date;
  endsAt: Date;
} {
  const zone = env.TIMEZONE;
  const start = DateTime.fromISO(dateYmd, { zone }).startOf('day');
  if (!start.isValid) {
    throw new Error('fecha inválida');
  }
  const end = start.plus({ days: 1 });
  return { startsAt: start.toJSDate(), endsAt: end.toJSDate() };
}

export function isWithinMaxDaysAhead(dateStr: string, maxDays: number): boolean {
  const zone = env.TIMEZONE;
  const today = DateTime.now().setZone(zone).startOf('day');
  const target = DateTime.fromISO(dateStr, { zone }).startOf('day');
  if (!target.isValid) return false;
  const diff = target.diff(today, 'days').days;
  return diff >= 0 && diff <= maxDays;
}

export function isSlotAllowedByMinLead(slotStart: DateTime, minLeadHours: number): boolean {
  const zone = env.TIMEZONE;
  const now = DateTime.now().setZone(zone);
  const earliest = now.plus({ hours: minLeadHours });
  return slotStart >= earliest;
}

export async function fetchBlockedRangesForWindow(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ starts_at: Date; ends_at: Date }[]> {
  const r = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `select starts_at, ends_at from blocked_ranges
     where starts_at < $2 and ends_at > $1
     order by starts_at asc`,
    [rangeStart, rangeEnd],
  );
  return r.rows;
}

/** Fechas YYYY-MM-DD (zona del negocio) donde existe un bloqueo que cubre todo el día calendario. */
export async function listFullyBlockedCalendarDatesInRange(
  fromYmd: string,
  toYmd: string,
): Promise<string[]> {
  const zone = env.TIMEZONE;
  const start = DateTime.fromISO(fromYmd, { zone }).startOf('day');
  const end = DateTime.fromISO(toYmd, { zone }).startOf('day');
  if (!start.isValid || !end.isValid || start > end) return [];

  const rangeEndExclusive = end.plus({ days: 1 });
  const r = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `select starts_at, ends_at from blocked_ranges
     where starts_at < $1 and ends_at > $2`,
    [rangeEndExclusive.toJSDate(), start.toJSDate()],
  );
  const blocks = r.rows;

  const out: string[] = [];
  let d = start;
  while (d <= end) {
    const ymd = d.toISODate()!;
    const { startsAt, endsAt } = blockedRangeForShopCalendarDay(ymd);
    const ds = startsAt.getTime();
    const de = endsAt.getTime();
    if (
      blocks.some(
        (b) =>
          new Date(b.starts_at).getTime() <= ds &&
          new Date(b.ends_at).getTime() >= de,
      )
    ) {
      out.push(ymd);
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

export function intervalOverlapsBlocked(
  slotStartMs: number,
  slotEndMs: number,
  blocks: { starts_at: Date; ends_at: Date }[],
): boolean {
  return blocks.some(
    (b) =>
      slotStartMs < new Date(b.ends_at).getTime() &&
      slotEndMs > new Date(b.starts_at).getTime(),
  );
}

export type BusinessHourRow = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
};

export async function listBusinessHours(): Promise<BusinessHourRow[]> {
  const r = await pool.query<BusinessHourRow>(
    `select day_of_week, is_closed, open_time::text, close_time::text
     from business_hours order by day_of_week asc`,
  );
  return r.rows.map((row) => ({
    ...row,
    open_time: row.open_time ? String(row.open_time).slice(0, 5) : null,
    close_time: row.close_time ? String(row.close_time).slice(0, 5) : null,
  }));
}

export async function computeAvailableSlots(params: {
  dateStr: string;
  barberId: string;
  serviceId: string;
}): Promise<
  | {
      slots: { startsAt: string; endsAt: string }[];
      service: {
        id: string;
        name: string;
        duration_minutes: number;
        price_cents: number;
      };
      timezone: string;
    }
  | { error: string }
> {
  const service = await getService(params.serviceId, true);
  if (!service) return { error: 'servicio no encontrado' };

  const settings = await getShopSettings();
  if (!isWithinMaxDaysAhead(params.dateStr, settings.bookingMaxDaysAhead)) {
    return { slots: [], service, timezone: env.TIMEZONE };
  }

  const openClose = await getOpenCloseForDate(params.dateStr);
  if (!openClose) {
    return { slots: [], service, timezone: env.TIMEZONE };
  }

  const { open, close } = openClose;
  const dayStartJs = open.toJSDate();
  const dayEndJs = close.toJSDate();

  const blocks = await fetchBlockedRangesForWindow(dayStartJs, dayEndJs);

  const existing = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `
      select starts_at, ends_at
      from appointments
      where barber_id = $1
        and status <> 'cancelled'
        and starts_at < $2
        and ends_at > $3
      order by starts_at asc
    `,
    [params.barberId, dayEndJs, dayStartJs],
  );

  const busy = existing.rows.map((r) => ({
    startsAt: new Date(r.starts_at).getTime(),
    endsAt: new Date(r.ends_at).getTime(),
  }));

  const slots: { startsAt: string; endsAt: string }[] = [];
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  const durationMs = service.duration_minutes * 60 * 1000;

  for (let t = open.toMillis(); t + durationMs <= close.toMillis(); t += stepMs) {
    const slotStart = DateTime.fromMillis(t, { zone: env.TIMEZONE });
    if (!isSlotAllowedByMinLead(slotStart, settings.bookingMinLeadHours)) continue;

    const slotStartMs = t;
    const slotEndMs = t + durationMs;

    if (
      intervalOverlapsBlocked(slotStartMs, slotEndMs, blocks)
    ) {
      continue;
    }

    const overlapsBusy = busy.some(
      (b) => slotStartMs < b.endsAt && slotEndMs > b.startsAt,
    );
    if (!overlapsBusy) {
      slots.push({
        startsAt: new Date(slotStartMs).toISOString(),
        endsAt: new Date(slotEndMs).toISOString(),
      });
    }
  }

  return { slots, service, timezone: env.TIMEZONE };
}

export async function assertBookingAllowed(params: {
  startsAt: Date;
  barberId: string;
  serviceId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = await getService(params.serviceId, true);
  if (!service) return { ok: false, error: 'servicio no encontrado' };

  const settings = await getShopSettings();
  const zone = env.TIMEZONE;
  const start = DateTime.fromJSDate(params.startsAt).setZone(zone);
  if (!start.isValid) return { ok: false, error: 'startsAt inválido' };

  const dateStr = start.toFormat('yyyy-MM-dd');
  if (!isWithinMaxDaysAhead(dateStr, settings.bookingMaxDaysAhead)) {
    return { ok: false, error: 'fecha fuera del rango permitido' };
  }
  if (!isSlotAllowedByMinLead(start, settings.bookingMinLeadHours)) {
    return { ok: false, error: 'anticipación mínima no cumplida' };
  }

  const openClose = await getOpenCloseForDate(dateStr);
  if (!openClose) return { ok: false, error: 'local cerrado ese día' };

  const endsAt = start.plus({ minutes: service.duration_minutes });
  if (start < openClose.open || endsAt > openClose.close) {
    return { ok: false, error: 'horario fuera del horario de atención' };
  }

  const msFromOpen = start.toMillis() - openClose.open.toMillis();
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  if (msFromOpen < 0 || msFromOpen % stepMs !== 0) {
    return { ok: false, error: 'horario no disponible' };
  }

  const slotStartMs = start.toMillis();
  const slotEndMs = endsAt.toMillis();
  const blocks = await fetchBlockedRangesForWindow(
    new Date(slotStartMs),
    new Date(slotEndMs),
  );
  if (intervalOverlapsBlocked(slotStartMs, slotEndMs, blocks)) {
    return { ok: false, error: 'ese horario no está disponible' };
  }

  return { ok: true };
}

export async function replaceBusinessHours(
  rows: { dayOfWeek: number; isClosed: boolean; openTime: string | null; closeTime: string | null }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const row of rows) {
      await client.query(
        `update business_hours set is_closed = $2, open_time = $3::time, close_time = $4::time
         where day_of_week = $1`,
        [
          row.dayOfWeek,
          row.isClosed,
          row.isClosed ? null : row.openTime,
          row.isClosed ? null : row.closeTime,
        ],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
