import { DateTime } from 'luxon'

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Etiquetas de inicio/fin de un bloqueo en la zona del local.
 * Si el rango es exactamente un día calendario [00:00, 00:00 del día siguiente),
 * muestra el fin como 23:59 del mismo día (en vez de medianoche del día siguiente).
 */
export function formatBlockedRangeDisplay(
  startsAtIso: string,
  endsAtIso: string,
  shopTimeZone: string,
): { startLabel: string; endLabel: string } {
  const start = DateTime.fromISO(startsAtIso, { zone: 'utc' }).setZone(
    shopTimeZone,
  )
  const end = DateTime.fromISO(endsAtIso, { zone: 'utc' }).setZone(shopTimeZone)
  if (!start.isValid || !end.isValid) {
    throw new Error('fecha inválida')
  }

  const dayStart = start.startOf('day')
  const expectedEnd = dayStart.plus({ days: 1 })
  const diffSec = end.diff(expectedEnd, 'seconds').seconds
  const isFullCalendarDay = Math.abs(diffSec) < 2

  if (isFullCalendarDay) {
    const d = dayStart.setLocale('es')
    return {
      startLabel: capitalize(d.toFormat('ccc dd-MM HH:mm')),
      endLabel: `${capitalize(d.toFormat('ccc dd-MM'))} 23:59`,
    }
  }

  return {
    startLabel: capitalize(start.setLocale('es').toFormat('ccc dd-MM HH:mm')),
    endLabel: capitalize(end.setLocale('es').toFormat('ccc dd-MM HH:mm')),
  }
}
