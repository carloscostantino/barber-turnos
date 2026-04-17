/** Partes opcionales de dirección (misma forma que `ShopSettingsRow` extendido). */
export type AddressParts = {
  contactAddress: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressFloor: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
};

/**
 * Una línea legible para mostrar y para búsqueda en Maps.
 * Prioriza partes estructuradas; si no hay ninguna, usa `contactAddress`.
 */
export function composeAddressLine(parts: AddressParts): string | null {
  const streetLine = [parts.addressStreet?.trim(), parts.addressNumber?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  const cityLine = [parts.addressPostalCode?.trim(), parts.addressCity?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim();

  const segments = [
    streetLine || null,
    parts.addressFloor?.trim() || null,
    cityLine || null,
    parts.addressRegion?.trim() || null,
  ].filter((s): s is string => Boolean(s && s.length > 0));

  const joined = segments.join(', ').trim();
  if (joined) return joined;

  const legacy = parts.contactAddress?.trim();
  return legacy ? legacy : null;
}
