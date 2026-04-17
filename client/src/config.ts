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
