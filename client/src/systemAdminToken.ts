const KEY = 'barber_turnos_system_admin_jwt'

export function getSystemAdminToken(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)?.trim()
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function setSystemAdminToken(token: string) {
  const t = token.trim()
  if (t) sessionStorage.setItem(KEY, t)
  else sessionStorage.removeItem(KEY)
}

export function clearSystemAdminToken() {
  sessionStorage.removeItem(KEY)
}
