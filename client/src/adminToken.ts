/**
 * Sesión del panel admin.
 *
 * Además del JWT guardamos el `shopSlug` para el que fue emitido: si el usuario
 * navega entre distintos `/s/<slug>/admin` podemos detectar el desajuste en el
 * cliente y forzar logout antes de mandar requests con un token ajeno. El
 * servidor igualmente verifica el slug de la URL contra el `shopId` del JWT
 * (`requireAdmin`), pero esta capa da mejor UX (evita 403s sorpresivos).
 */
const TOKEN_KEY = 'barber_turnos_admin_jwt'
const SLUG_KEY = 'barber_turnos_admin_slug'

export type AdminSession = {
  token: string
  shopSlug: string
}

function readRaw(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key)?.trim()
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

export function getAdminSession(): AdminSession | null {
  const token = readRaw(TOKEN_KEY)
  const slug = readRaw(SLUG_KEY)
  if (!token || !slug) return null
  return { token, shopSlug: slug }
}

/** Devuelve el token solo si fue emitido para `expectedSlug`. */
export function getAdminTokenForSlug(expectedSlug: string): string | null {
  const s = getAdminSession()
  if (!s) return null
  if (normalizeSlug(s.shopSlug) !== normalizeSlug(expectedSlug)) return null
  return s.token
}

export function setAdminSession(session: AdminSession) {
  const token = session.token.trim()
  const slug = session.shopSlug.trim()
  if (!token || !slug) {
    clearAdminSession()
    return
  }
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(SLUG_KEY, slug)
}

export function clearAdminSession() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(SLUG_KEY)
}

/**
 * Aliases que preservan la API previa usada en varios lugares del cliente
 * (p. ej. algún hook que solo quiere el token sin conocer el slug).
 * Marcan las llamadas que todavía no diferencian por shop; nuevas rutas
 * deberían preferir `getAdminTokenForSlug`.
 */
export function getAdminToken(): string | null {
  return readRaw(TOKEN_KEY)
}

/** Compat: setear solo el token se considera inválido — quedó aislado en dev. */
export function setAdminToken(_token: string) {
  throw new Error('setAdminToken está obsoleto: usá setAdminSession({ token, shopSlug }).')
}

export function clearAdminToken() {
  clearAdminSession()
}
