/**
 * Helpers comunes a los tests E2E. El webServer de Playwright levanta la API
 * dedicada en `127.0.0.1:3002`; `page.request` usa `baseURL` (5174, el de
 * Vite), así que todas las llamadas al backend las hacemos con URL absoluta.
 */
export const API_BASE = 'http://127.0.0.1:3002/api';

export const DEFAULT_SLUG =
  process.env.E2E_DEFAULT_SHOP_SLUG ?? 'default';

export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? 'admin12345';

export const SYSTEM_ADMIN_PASSWORD =
  process.env.E2E_SYSTEM_ADMIN_PASSWORD ??
  process.env.SYSTEM_ADMIN_PASSWORD ??
  'e2e-system-admin-pass';

export async function loginAdminApi(slug: string): Promise<string> {
  const res = await fetch(`${API_BASE}/shops/${slug}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `login admin de ${slug} falló: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function loginSystemApi(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/system/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SYSTEM_ADMIN_PASSWORD }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string };
  return data.token ?? null;
}

/**
 * Restaura la shop demo a `active` vía API del sistema. Útil en `afterEach`
 * del test que toca `suspend/unsuspend` para no dejar el estado roto.
 */
export async function restoreDefaultToActive(): Promise<void> {
  const token = await loginSystemApi();
  if (!token) return;

  const list = await fetch(`${API_BASE}/system/shops`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) return;
  const shops = (await list.json()) as Array<{ id: string; slug: string }>;
  const demo = shops.find((s) => s.slug === DEFAULT_SLUG);
  if (!demo) return;

  await fetch(`${API_BASE}/system/shops/${demo.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: 'active' }),
  });
}

type ServiceRow = {
  id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
  is_favorite?: boolean;
};

type Slot = { startsAt: string; endsAt: string };

/**
 * Busca un servicio + fecha + slot reservable en los próximos `daysAhead`
 * días. Útil para crear turnos de prueba sin asumir que hoy tiene slots.
 */
export async function findReservableSlot(
  slug: string,
  daysAhead = 15,
): Promise<{ service: ServiceRow; slot: Slot; date: string }> {
  const servicesRes = await fetch(`${API_BASE}/shops/${slug}/services`);
  const services = (await servicesRes.json()) as ServiceRow[];
  if (services.length === 0) throw new Error('el local no tiene servicios');
  const service =
    services.find((s) => s.is_favorite) ?? services[0]!;

  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const url =
      `${API_BASE}/shops/${slug}/availability` +
      `?serviceId=${encodeURIComponent(service.id)}&date=${iso}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const body = (await res.json()) as { slots: Slot[] };
    if (body.slots.length > 0) {
      return { service, slot: body.slots[0]!, date: iso };
    }
  }
  throw new Error(
    `no se encontraron slots disponibles para ${slug} en ${daysAhead} días`,
  );
}

export async function createAppointmentApi(
  slug: string,
  input: {
    serviceId: string;
    startsAt: string;
    customer: { name: string; phone: string; email: string };
  },
): Promise<{ id: string; starts_at: string }> {
  const res = await fetch(`${API_BASE}/shops/${slug}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(
      `reserva en ${slug} falló: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as { id: string; starts_at: string };
}
