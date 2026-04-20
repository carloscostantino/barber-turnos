export const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api'

/** Slug del local en la URL (`/s/:slug`). Debe coincidir con un shop en la base. */
export const DEFAULT_SHOP_SLUG =
  import.meta.env.VITE_DEFAULT_SHOP_SLUG ?? 'default'

/** Ruta API pública bajo `/api/shops/:slug/...` (sin query). */
export function shopPublicPath(shopSlug: string, path: string): string {
  const clean = path.replace(/^\//, '')
  return `${API_BASE}/shops/${encodeURIComponent(shopSlug)}/${clean}`
}

/**
 * Ruta API admin bajo `/api/shops/:slug/admin/...`. Se resuelve así (en vez
 * de un plano `/api/admin/...`) para que el middleware `requireAdmin` valide
 * server-side que el JWT del admin corresponde al local identificado por el
 * slug de la URL. Sin esta validación un token emitido para la shop A podía
 * operar contra la shop B.
 */
export function shopAdminPath(shopSlug: string, path: string): string {
  const clean = path.replace(/^\//, '')
  return `${API_BASE}/shops/${encodeURIComponent(shopSlug)}/admin/${clean}`
}
