export function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
}

export function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Inicio del día local y fin exclusivo (medianoche del día siguiente), en ISO UTC. */
export function dayRangeIso(dateYmd: string): { from: string; to: string } {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return { from: start.toISOString(), to: end.toISOString() }
}
