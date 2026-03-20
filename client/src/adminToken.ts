const KEY = 'barber_turnos_admin_jwt'

export function getAdminToken(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)?.trim()
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function setAdminToken(token: string) {
  const t = token.trim()
  if (t) sessionStorage.setItem(KEY, t)
  else sessionStorage.removeItem(KEY)
}

export function clearAdminToken() {
  sessionStorage.removeItem(KEY)
}
