export function digitsOnly(s: string) {
  return s.replace(/\D/g, '')
}

/** Devuelve `https://wa.me/{digits}` o `null` si no hay número usable. */
export function whatsappHrefFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = digitsOnly(phone)
  if (d.length < 8) return null
  return `https://wa.me/${d}`
}

/** Abre Google Maps con búsqueda por texto (dirección libre). */
export function mapsSearchUrlFromAddress(address: string | null | undefined): string | null {
  const t = address?.trim()
  if (!t) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`
}
