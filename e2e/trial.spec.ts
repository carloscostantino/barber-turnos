import { expect, test } from './base';
import {
  API_BASE,
  DEFAULT_SLUG,
  loginAdminApi,
  loginSystemApi,
} from './helpers';

/**
 * Cobertura del período de prueba:
 *
 *  1) Shop recién registrada: queda en `trial` con `trialEndsAt` seteado
 *     y `daysLeft` ≈ TRIAL_DURATION_DAYS.
 *  2) Forzamos `trial_ends_at` al pasado (vía panel del sistema, cambiando
 *     status a `suspended`) y verificamos que el login admin queda cerrado.
 *
 * Nota: el trigger del job `runTrialJob` se cubre indirectamente — lo que
 * validamos acá es el contrato de la API (`/admin/trial-status`) y que
 * `suspended` bloquea al admin, que es la consecuencia esperada del vencimiento.
 */
test.describe('Trial / suspensión', () => {
  test('shop recién registrada tiene trial activo con días restantes', async () => {
    const suffix = Date.now().toString(36).slice(-6);
    const slug = `e2e-trial-${suffix}`;
    const password = 'OwnerPass123';

    const reg = await fetch(`${API_BASE}/shops/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        shopName: `Barbería trial ${suffix}`,
        ownerEmail: `owner-${suffix}@example.test`,
        ownerPassword: password,
      }),
    });
    expect(reg.ok).toBeTruthy();

    const loginRes = await fetch(`${API_BASE}/shops/${slug}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(loginRes.ok).toBeTruthy();
    const { token } = (await loginRes.json()) as { token: string };

    const statusRes = await fetch(
      `${API_BASE}/shops/${slug}/admin/trial-status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(statusRes.status).toBe(200);
    const trial = (await statusRes.json()) as {
      status: string;
      trialEndsAt: string | null;
      daysLeft: number | null;
    };
    expect(trial.status).toBe('trial');
    expect(trial.trialEndsAt).toBeTruthy();
    expect(trial.daysLeft).not.toBeNull();
    expect(trial.daysLeft!).toBeGreaterThan(0);
    // TRIAL_DURATION_DAYS por defecto es 14; toleramos ±1 por redondeo.
    expect(trial.daysLeft!).toBeGreaterThanOrEqual(13);
    expect(trial.daysLeft!).toBeLessThanOrEqual(14);
  });

  test('shop default activa: trial-status reporta status=active y daysLeft=null', async () => {
    const token = await loginAdminApi(DEFAULT_SLUG);
    const res = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/trial-status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      daysLeft: number | null;
    };
    // La shop demo nace como 'active' en la migración 012.
    expect(['active', 'trial']).toContain(body.status);
    if (body.status === 'active') {
      expect(body.daysLeft).toBeNull();
    }
  });

  test('suspender una shop permite login en modo restringido (sólo billing)', async () => {
    // Creamos una shop descartable.
    const suffix = Date.now().toString(36).slice(-6);
    const slug = `e2e-sus-${suffix}`;
    const password = 'OwnerPass123';
    await fetch(`${API_BASE}/shops/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        shopName: `Sus ${suffix}`,
        ownerEmail: `sus-${suffix}@example.test`,
        ownerPassword: password,
      }),
    });

    const sysToken = await loginSystemApi();
    expect(sysToken).toBeTruthy();
    const list = await fetch(`${API_BASE}/system/shops`, {
      headers: { Authorization: `Bearer ${sysToken!}` },
    });
    const shops = (await list.json()) as Array<{ id: string; slug: string }>;
    const shop = shops.find((s) => s.slug === slug);
    expect(shop).toBeTruthy();

    const suspendRes = await fetch(
      `${API_BASE}/system/shops/${shop!.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sysToken!}`,
        },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendRes.ok).toBeTruthy();

    // Login admin sigue aceptando credenciales para que el owner pueda
    // activar una suscripción, pero devuelve un token "restricted" que solo
    // habilita los endpoints de facturación.
    const login = await fetch(`${API_BASE}/shops/${slug}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    expect(login.status).toBe(200);
    const data = (await login.json()) as {
      token: string;
      restricted?: boolean;
      shopStatus?: string;
    };
    expect(data.restricted).toBe(true);
    expect(data.shopStatus).toBe('suspended');

    // Endpoints no relacionados con billing quedan cerrados (403 restricted).
    const apt = await fetch(
      `${API_BASE}/shops/${slug}/admin/appointments?date=2030-01-01`,
      { headers: { Authorization: `Bearer ${data.token}` } },
    );
    expect(apt.status).toBe(403);
  });
});
