const KEY = 'barber_turnos_admin_jwt'

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setAdminToken(token: string) {
  sessionStorage.setItem(KEY, token)
}

export function clearAdminToken() {
  sessionStorage.removeItem(KEY)
}
