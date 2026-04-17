import { DateTime } from 'luxon';
import { getService } from './api';
import { pool } from './db';

export const SLOT_STEP_MINUTES = 15;

export type ShopSettingsRow = {
  bookingMinLeadHours: number;
  bookingMaxDaysAhead: number;
  shopName: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  contactAddress: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressFloor: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
};

export async function getShopSettings(shopId: string): Promise<ShopSettingsRow> {
  const r = await pool.query<{
    booking_min_lead_hours: number;
    booking_max_days_ahead: number;
    shop_name: string | null;
    contact_whatsapp: string | null;
    contact_email: string | null;
    contact_address: string | null;
    address_street: string | null;
    address_number: string | null;
    address_floor: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
  }>(
    `select booking_min_lead_hours, booking_max_days_ahead, shop_name, contact_whatsapp, contact_email, contact_address,
            address_street, address_number, address_floor, address_city, address_region, address_postal_code
     from shop_settings where shop_id = $1`,
    [shopId],
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
    addressStreet: row.address_street,
    addressNumber: row.address_number,
    addressFloor: row.address_floor,
    addressCity: row.address_city,
    addressRegion: row.address_region,
    addressPostalCode: row.address_postal_code,
  };
}

export async function updateShopSettings(
  shopId: string,
  data: {
    bookingMinLeadHours: number;
    bookingMaxDaysAhead: number;
    shopName?: string | null;
    contactWhatsapp?: string | null;
    contactEmail?: string | null;
    contactAddress?: string | null;
    addressStreet?: string | null;
    addressNumber?: string | null;
    addressFloor?: string | null;
    addressCity?: string | null;
    addressRegion?: string | null;
    addressPostalCode?: string | null;
  },
): Promise<ShopSettingsRow> {
  const current = await getShopSettings(shopId);
  const shopName = data.shopName !== undefined ? data.shopName : current.shopName;
  const contactWhatsapp =
    data.contactWhatsapp !== undefined ? data.contactWhatsapp : current.contactWhatsapp;
  const contactEmail = data.contactEmail !== undefined ? data.contactEmail : current.contactEmail;
  const contactAddress =
    data.contactAddress !== undefined ? data.contactAddress : current.contactAddress;
  const addressStreet =
    data.addressStreet !== undefined ? data.addressStreet : current.addressStreet;
  const addressNumber =
    data.addressNumber !== undefined ? data.addressNumber : current.addressNumber;
  const addressFloor = data.addressFloor !== undefined ? data.addressFloor : current.addressFloor;
  const addressCity = data.addressCity !== undefined ? data.addressCity : current.addressCity;
  const addressRegion =
    data.addressRegion !== undefined ? data.addressRegion : current.addressRegion;
  const addressPostalCode =
    data.addressPostalCode !== undefined ? data.addressPostalCode : current.addressPostalCode;

  const r = await pool.query<{
    booking_min_lead_hours: number;
    booking_max_days_ahead: number;
    shop_name: string | null;
    contact_whatsapp: string | null;
    contact_email: string | null;
    contact_address: string | null;
    address_street: string | null;
    address_number: string | null;
    address_floor: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
  }>(
    `update shop_settings set booking_min_lead_hours = $1, booking_max_days_ahead = $2, shop_name = $3, contact_whatsapp = $4, contact_email = $5, contact_address = $6,
        address_street = $7, address_number = $8, address_floor = $9, address_city = $10, address_region = $11, address_postal_code = $12
     where shop_id = $13
     returning booking_min_lead_hours, booking_max_days_ahead, shop_name, contact_whatsapp, contact_email, contact_address,
               address_street, address_number, address_floor, address_city, address_region, address_postal_code`,
    [
      data.bookingMinLeadHours,
      data.bookingMaxDaysAhead,
      shopName,
      contactWhatsapp,
      contactEmail,
      contactAddress,
      addressStreet,
      addressNumber,
      addressFloor,
      addressCity,
      addressRegion,
      addressPostalCode,
      shopId,
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
    addressStreet: row.address_street,
    addressNumber: row.address_number,
    addressFloor: row.address_floor,
    addressCity: row.address_city,
    addressRegion: row.address_region,
    addressPostalCode: row.address_postal_code,
  };
}

/** 0 = lunes … 6 = domingo (Luxon weekday 1–7 → 0–6). */
export function weekdayMon0FromDateStr(dateStr: string, zone: string): number {
  const dt = DateTime.fromISO(dateStr, { zone });
  if (!dt.isValid) return 0;
  return dt.weekday - 1;
}

/** Tramos de atención en un día (uno sin siesta; dos con siesta mañana/tarde). */
export async function getOpenCloseIntervalsForDate(
  shopId: string,
  dateStr: string,
  zone: string,
): Promise<{ open: DateTime; close: DateTime }[] | null> {
  const base = DateTime.fromISO(dateStr, { zone });
  if (!base.isValid) return null;
  const dow = base.weekday - 1;
  const r = await pool.query<{
    is_closed: boolean;
    open_time: string | null;
    close_time: string | null;
    open_time_afternoon: string | null;
    close_time_afternoon: string | null;
  }>(
    `select is_closed, open_time::text, close_time::text, open_time_afternoon::text, close_time_afternoon::text
     from business_hours where shop_id = $1 and day_of_week = $2`,
    [shopId, dow],
  );
  const row = r.rows[0];
  if (!row || row.is_closed || !row.open_time || !row.close_time) return null;

  const slice5 = (t: string) => String(t).slice(0, 5);
  const mk = (hm: string) => {
    const [h, m, s] = hm.split(/[:.]/).map((x) => parseInt(x, 10));
    return base.set({
      hour: h,
      minute: m ?? 0,
      second: s ?? 0,
      millisecond: 0,
    });
  };

  const open1 = mk(slice5(row.open_time));
  const close1 = mk(slice5(row.close_time));
  if (close1 <= open1) return null;

  const oaRaw = row.open_time_afternoon;
  const caRaw = row.close_time_afternoon;
  const hasAfternoon = oaRaw != null && String(oaRaw).trim() !== '' && caRaw != null && String(caRaw).trim() !== '';

  if (!hasAfternoon) {
    return [{ open: open1, close: close1 }];
  }

  const open2 = mk(slice5(String(oaRaw)));
  const close2 = mk(slice5(String(caRaw)));
  if (close2 <= open2) return null;
  if (close1 >= open2) return null;
  return [
    { open: open1, close: close1 },
    { open: open2, close: close2 },
  ];
}

/** Inicio (inclusivo) y fin (exclusivo) del día calendario en la zona del negocio. */
export function blockedRangeForShopCalendarDay(
  dateYmd: string,
  zone: string,
): {
  startsAt: Date;
  endsAt: Date;
} {
  const start = DateTime.fromISO(dateYmd, { zone }).startOf('day');
  if (!start.isValid) {
    throw new Error('fecha inválida');
  }
  const end = start.plus({ days: 1 });
  return { startsAt: start.toJSDate(), endsAt: end.toJSDate() };
}

export function isWithinMaxDaysAhead(dateStr: string, maxDays: number, zone: string): boolean {
  const today = DateTime.now().setZone(zone).startOf('day');
  const target = DateTime.fromISO(dateStr, { zone }).startOf('day');
  if (!target.isValid) return false;
  const diff = target.diff(today, 'days').days;
  return diff >= 0 && diff <= maxDays;
}

export function isSlotAllowedByMinLead(
  slotStart: DateTime,
  minLeadHours: number,
  zone: string,
): boolean {
  const now = DateTime.now().setZone(zone);
  const earliest = now.plus({ hours: minLeadHours });
  return slotStart >= earliest;
}

export async function fetchBlockedRangesForWindow(
  shopId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ starts_at: Date; ends_at: Date }[]> {
  const r = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `select starts_at, ends_at from blocked_ranges
     where shop_id = $1 and starts_at < $3 and ends_at > $2
     order by starts_at asc`,
    [shopId, rangeStart, rangeEnd],
  );
  return r.rows;
}

/** Fechas YYYY-MM-DD (zona del negocio) donde existe un bloqueo que cubre todo el día calendario. */
export async function listFullyBlockedCalendarDatesInRange(
  shopId: string,
  fromYmd: string,
  toYmd: string,
  zone: string,
): Promise<string[]> {
  const start = DateTime.fromISO(fromYmd, { zone }).startOf('day');
  const end = DateTime.fromISO(toYmd, { zone }).startOf('day');
  if (!start.isValid || !end.isValid || start > end) return [];

  const rangeEndExclusive = end.plus({ days: 1 });
  const r = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `select starts_at, ends_at from blocked_ranges
     where shop_id = $1 and starts_at < $3 and ends_at > $2`,
    [shopId, start.toJSDate(), rangeEndExclusive.toJSDate()],
  );
  const blocks = r.rows;

  const out: string[] = [];
  let d = start;
  while (d <= end) {
    const ymd = d.toISODate()!;
    const { startsAt, endsAt } = blockedRangeForShopCalendarDay(ymd, zone);
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
  open_time_afternoon: string | null;
  close_time_afternoon: string | null;
};

export async function listBusinessHours(shopId: string): Promise<BusinessHourRow[]> {
  const r = await pool.query<BusinessHourRow>(
    `select day_of_week, is_closed, open_time::text, close_time::text,
            open_time_afternoon::text, close_time_afternoon::text
     from business_hours where shop_id = $1 order by day_of_week asc`,
    [shopId],
  );
  return r.rows.map((row) => ({
    ...row,
    open_time: row.open_time ? String(row.open_time).slice(0, 5) : null,
    close_time: row.close_time ? String(row.close_time).slice(0, 5) : null,
    open_time_afternoon: row.open_time_afternoon
      ? String(row.open_time_afternoon).slice(0, 5)
      : null,
    close_time_afternoon: row.close_time_afternoon
      ? String(row.close_time_afternoon).slice(0, 5)
      : null,
  }));
}

export async function computeAvailableSlots(params: {
  shopId: string;
  timezone: string;
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
  const { shopId, timezone: zone } = params;
  const service = await getService(shopId, params.serviceId, true);
  if (!service) return { error: 'servicio no encontrado' };

  const settings = await getShopSettings(shopId);
  if (!isWithinMaxDaysAhead(params.dateStr, settings.bookingMaxDaysAhead, zone)) {
    return { slots: [], service, timezone: zone };
  }

  const intervals = await getOpenCloseIntervalsForDate(shopId, params.dateStr, zone);
  if (!intervals || intervals.length === 0) {
    return { slots: [], service, timezone: zone };
  }

  const dayStartJs = intervals[0]!.open.toJSDate();
  const dayEndJs = intervals[intervals.length - 1]!.close.toJSDate();

  const blocks = await fetchBlockedRangesForWindow(shopId, dayStartJs, dayEndJs);

  const existing = await pool.query<{ starts_at: Date; ends_at: Date }>(
    `
      select starts_at, ends_at
      from appointments
      where shop_id = $1
        and barber_id = $2
        and status <> 'cancelled'
        and starts_at < $3
        and ends_at > $4
      order by starts_at asc
    `,
    [shopId, params.barberId, dayEndJs, dayStartJs],
  );

  const busy = existing.rows.map((r) => ({
    startsAt: new Date(r.starts_at).getTime(),
    endsAt: new Date(r.ends_at).getTime(),
  }));

  const slots: { startsAt: string; endsAt: string }[] = [];
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  const durationMs = service.duration_minutes * 60 * 1000;

  for (const { open, close } of intervals) {
    for (let t = open.toMillis(); t + durationMs <= close.toMillis(); t += stepMs) {
      const slotStart = DateTime.fromMillis(t, { zone });
      if (!isSlotAllowedByMinLead(slotStart, settings.bookingMinLeadHours, zone)) continue;

      const slotStartMs = t;
      const slotEndMs = t + durationMs;

      if (intervalOverlapsBlocked(slotStartMs, slotEndMs, blocks)) {
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
  }

  return { slots, service, timezone: zone };
}

export async function assertBookingAllowed(params: {
  shopId: string;
  timezone: string;
  startsAt: Date;
  barberId: string;
  serviceId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = await getService(params.shopId, params.serviceId, true);
  if (!service) return { ok: false, error: 'servicio no encontrado' };

  const settings = await getShopSettings(params.shopId);
  const zone = params.timezone;
  const start = DateTime.fromJSDate(params.startsAt).setZone(zone);
  if (!start.isValid) return { ok: false, error: 'startsAt inválido' };

  const dateStr = start.toFormat('yyyy-MM-dd');
  if (!isWithinMaxDaysAhead(dateStr, settings.bookingMaxDaysAhead, zone)) {
    return { ok: false, error: 'fecha fuera del rango permitido' };
  }
  if (!isSlotAllowedByMinLead(start, settings.bookingMinLeadHours, zone)) {
    return { ok: false, error: 'anticipación mínima no cumplida' };
  }

  const intervals = await getOpenCloseIntervalsForDate(params.shopId, dateStr, zone);
  if (!intervals || intervals.length === 0) return { ok: false, error: 'local cerrado ese día' };

  const endsAt = start.plus({ minutes: service.duration_minutes });
  const seg = intervals.find((iv) => start >= iv.open && endsAt <= iv.close);
  if (!seg) {
    return { ok: false, error: 'horario fuera del horario de atención' };
  }

  const msFromSegOpen = start.toMillis() - seg.open.toMillis();
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  if (msFromSegOpen < 0 || msFromSegOpen % stepMs !== 0) {
    return { ok: false, error: 'horario no disponible' };
  }

  const slotStartMs = start.toMillis();
  const slotEndMs = endsAt.toMillis();
  const blocks = await fetchBlockedRangesForWindow(
    params.shopId,
    new Date(slotStartMs),
    new Date(slotEndMs),
  );
  if (intervalOverlapsBlocked(slotStartMs, slotEndMs, blocks)) {
    return { ok: false, error: 'ese horario no está disponible' };
  }

  return { ok: true };
}

export async function replaceBusinessHours(
  shopId: string,
  rows: {
    dayOfWeek: number;
    isClosed: boolean;
    openTime: string | null;
    closeTime: string | null;
    openTimeAfternoon: string | null;
    closeTimeAfternoon: string | null;
  }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const row of rows) {
      await client.query(
        `update business_hours set is_closed = $3, open_time = $4::time, close_time = $5::time,
            open_time_afternoon = $6::time, close_time_afternoon = $7::time
         where shop_id = $1 and day_of_week = $2`,
        [
          shopId,
          row.dayOfWeek,
          row.isClosed,
          row.openTime,
          row.closeTime,
          row.openTimeAfternoon,
          row.closeTimeAfternoon,
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
