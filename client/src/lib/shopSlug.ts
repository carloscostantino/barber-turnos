/**
 * Genera un identificador de URL a partir del nombre del local:
 * minúsculas, sin acentos, solo `a-z`, `0-9` y guiones (máx. 50 caracteres).
 */
export function normalizeShopSlug(input: string): string {
  const s = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s.slice(0, 50)
}

/** Título visible cuando no hay `shopName` en API (p. ej. slug `mi-barberia` → "Mi Barberia"). */
export function displayTitleFromSlug(slug: string): string {
  const s = slug.trim()
  if (!s) return ''
  return s
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
