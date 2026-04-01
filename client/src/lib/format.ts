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

/** Pesos enteros, miles con punto (ej. $1.500). Sin decimales. */
export function formatPesosArFromCents(price_cents: number): string {
  const whole = Math.round(price_cents / 100)
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(whole)
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

/**
 * Vista «Próximos turnos» del panel: solo turnos vigentes y futuros (desde ahora),
 * hasta 1 ene (año+2) exclusivo — no incluye turnos ya terminados.
 */
export function listFutureTurnosRangeIso(): { from: string; to: string } {
  const y = new Date().getFullYear()
  const to = new Date(y + 2, 0, 1, 0, 0, 0, 0)
  return { from: new Date().toISOString(), to: to.toISOString() }
}
