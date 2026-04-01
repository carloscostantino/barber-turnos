import { DateTime } from 'luxon'

export type BusinessHourPublic = { dayOfWeek: number; isClosed: boolean }

/** Días YYYY-MM-DD en los que se puede reservar (no cerrados por horario ni bloqueo de día completo). */
export function buildEligibleBookingDates(params: {
  minYmd: string
  maxYmd: string
  shopTimezone: string
  businessHours: BusinessHourPublic[]
  fullyBlockedDates: readonly string[]
}): string[] {
  const { minYmd, maxYmd, shopTimezone, businessHours, fullyBlockedDates } =
    params
  const blocked = new Set(fullyBlockedDates)
  const byDow = new Map(
    businessHours.map((h) => [h.dayOfWeek, h.isClosed] as const),
  )

  const start = DateTime.fromISO(minYmd, { zone: shopTimezone }).startOf(
    'day',
  )
  const end = DateTime.fromISO(maxYmd, { zone: shopTimezone }).startOf('day')
  if (!start.isValid || !end.isValid || start > end) return []

  const out: string[] = []
  let cur = start
  while (cur <= end) {
    const ymd = cur.toISODate()!
    const dow = cur.weekday - 1
    if (byDow.get(dow) === true) {
      cur = cur.plus({ days: 1 })
      continue
    }
    if (blocked.has(ymd)) {
      cur = cur.plus({ days: 1 })
      continue
    }
    out.push(ymd)
    cur = cur.plus({ days: 1 })
  }
  return out
}

export function formatBookingDateOptionLabel(
  ymd: string,
  shopTimezone: string,
): string {
  const dt = DateTime.fromISO(ymd, { zone: shopTimezone })
  if (!dt.isValid) return ymd
  const raw = dt.setLocale('es').toFormat('ccc d MMM')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/** Fecha local del navegador → YYYY-MM-DD (misma convención que `toInputDate`). */
export function toYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → `Date` a mediodía local (evita bordes DST al mostrar en calendarios). */
export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}
