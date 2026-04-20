import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  API_BASE,
  DEFAULT_SLUG,
  loginAdminApi,
  loginSystemApi,
} from './helpers';

/**
 * Tests de facturación (Mercado Pago):
 *
 *  - la shop suspended igual puede loguearse en modo restringido,
 *  - el webhook `authorized` activa la shop,
 *  - el webhook `cancelled` la suspende.
 *
 * Todo sucede contra `MP_MOCK_PREAPPROVAL_STATUS` (Playwright lo exporta al
 * webServer), así que nunca salimos a la API real de MP.
 */

const MP_WEBHOOK_SECRET = 'e2e-mp-webhook-secret';
const MOCK_PREAPPROVAL_ID = 'MP-E2E-TEST-PREAPPROVAL';

function buildMpSignature(
  dataId: string,
  requestId: string,
  ts: string,
): string {
  const template = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', MP_WEBHOOK_SECRET)
    .update(template)
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}

/**
 * Cache del token de system-admin y del id de la shop demo para evitar
 * superar el rate limit del login del panel de sistema durante los tests.
 */
let cachedSystemToken: string | null = null;
let cachedDefaultShopId: string | null = null;

async function getSystemToken(): Promise<string> {
  if (cachedSystemToken) return cachedSystemToken;
  const token = await loginSystemApi();
  if (!token) throw new Error('no pude loguear al sistema');
  cachedSystemToken = token;
  return token;
}

async function getDefaultShopId(): Promise<string> {
  if (cachedDefaultShopId) return cachedDefaultShopId;
  const token = await getSystemToken();
  const res = await fetch(`${API_BASE}/system/shops`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const shops = (await res.json()) as Array<{ id: string; slug: string }>;
  const demo = shops.find((s) => s.slug === DEFAULT_SLUG);
  if (!demo) throw new Error('no existe la shop demo');
  cachedDefaultShopId = demo.id;
  return demo.id;
}

async function setDefaultShopStatus(
  status: 'active' | 'trial' | 'suspended',
): Promise<void> {
  const token = await getSystemToken();
  const id = await getDefaultShopId();
  const res = await fetch(`${API_BASE}/system/shops/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(
      `no pude setear status=${status}: ${res.status} ${await res.text()}`,
    );
  }
}

async function setMpMock(
  status: 'authorized' | 'cancelled' | 'paused' | 'pending',
): Promise<void> {
  const token = await getSystemToken();
  const res = await fetch(`${API_BASE}/system/e2e/mp-mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(
      `no pude setear mock MP: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Login admin y POST /admin/billing/subscribe (ambos permitidos en modo
 * restringido). En modo E2E (con `MP_MOCK_PREAPPROVAL_STATUS` definido)
 * `createOrGetPreapprovalForShop` upserta `shop_subscriptions` sin llamar a MP
 * y devuelve un preapprovalId determinístico.
 */
async function subscribeAsOwnerApi(): Promise<string> {
  const loginRes = await fetch(
    `${API_BASE}/shops/${DEFAULT_SLUG}/admin/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    },
  );
  const loginData = (await loginRes.json()) as { token: string };

  const subRes = await fetch(
    `${API_BASE}/shops/${DEFAULT_SLUG}/admin/billing/subscribe`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
    },
  );
  expect(subRes.ok).toBe(true);
  const data = (await subRes.json()) as { preapprovalId: string };
  return data.preapprovalId;
}

async function fireMpWebhook(preapprovalId: string): Promise<number> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const requestId = `e2e-${preapprovalId}-${ts}`;
  const sig = buildMpSignature(preapprovalId, requestId, ts);
  const res = await fetch(`${API_BASE}/webhooks/mercadopago`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      'x-signature': sig,
    },
    body: JSON.stringify({
      type: 'preapproval',
      data: { id: preapprovalId },
    }),
  });
  return res.status;
}

test.describe('billing MP', () => {
  test.beforeEach(async () => {
    // Estado por defecto al iniciar cada test: MP mock en authorized + shop
    // demo active. Los tests cambian ambas cosas a lo suyo.
    await setMpMock('authorized');
    await setDefaultShopStatus('active');
  });

  test.afterEach(async () => {
    await setMpMock('authorized');
    await setDefaultShopStatus('active');
  });

  test('shop suspended recibe token restringido y solo puede billing', async () => {
    await setDefaultShopStatus('suspended');

    const loginRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      },
    );
    expect(loginRes.ok).toBe(true);
    const loginData = (await loginRes.json()) as {
      token: string;
      restricted?: boolean;
      shopStatus?: string;
    };
    expect(loginData.restricted).toBe(true);
    expect(loginData.shopStatus).toBe('suspended');

    const authHeader = { Authorization: `Bearer ${loginData.token}` };

    // Billing status está permitido.
    const statusRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/billing/status`,
      { headers: authHeader },
    );
    expect(statusRes.ok).toBe(true);

    // Appointments no: el middleware devuelve 403 restricted.
    const aptRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/appointments?date=2030-01-01`,
      { headers: authHeader },
    );
    expect(aptRes.status).toBe(403);
  });

  test('webhook authorized activa la shop suspended', async () => {
    await setDefaultShopStatus('suspended');
    await setMpMock('authorized');

    // El owner, en modo restringido, crea el preapproval (sin salir a MP
    // porque MP_MOCK está activo).
    const preapprovalId = await subscribeAsOwnerApi();

    // Simulamos la confirmación que MP envía por webhook.
    const status = await fireMpWebhook(preapprovalId);
    expect(status).toBe(200);

    const sysToken = await getSystemToken();
    const list = await fetch(`${API_BASE}/system/shops`, {
      headers: { Authorization: `Bearer ${sysToken}` },
    });
    const shops = (await list.json()) as Array<{
      slug: string;
      status: string;
      subscription_status: string | null;
      subscription_provider: string | null;
    }>;
    const demo = shops.find((s) => s.slug === DEFAULT_SLUG)!;
    expect(demo.status).toBe('active');
    expect(demo.subscription_status).toBe('active');
    expect(demo.subscription_provider).toBe('mercadopago');
  });

  test('webhook cancelled suspende la shop', async () => {
    // Autorizada primero.
    await setMpMock('authorized');
    const preapprovalId = await subscribeAsOwnerApi();
    expect(await fireMpWebhook(preapprovalId)).toBe(200);

    // Ahora el mismo preapproval pero en estado cancelled.
    await setMpMock('cancelled');
    expect(await fireMpWebhook(preapprovalId)).toBe(200);

    const sysToken = await getSystemToken();
    const list = await fetch(`${API_BASE}/system/shops`, {
      headers: { Authorization: `Bearer ${sysToken}` },
    });
    const shops = (await list.json()) as Array<{
      slug: string;
      status: string;
      subscription_status: string | null;
    }>;
    const demo = shops.find((s) => s.slug === DEFAULT_SLUG)!;
    expect(demo.status).toBe('suspended');
    expect(demo.subscription_status).toBe('canceled');

    // El owner aún puede loguearse en modo restringido.
    const token = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      },
    );
    const loginData = (await token.json()) as { restricted?: boolean };
    expect(loginData.restricted).toBe(true);
  });

  test('firma inválida es rechazada', async () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const res = await fetch(`${API_BASE}/webhooks/mercadopago`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'fake-req',
        'x-signature': `ts=${ts},v1=deadbeef`,
      },
      body: JSON.stringify({
        type: 'preapproval',
        data: { id: MOCK_PREAPPROVAL_ID },
      }),
    });
    expect(res.status).toBe(401);

    // Verificamos sanity: el login admin del demo se puede hacer normalmente.
    const token = await loginAdminApi(DEFAULT_SLUG);
    expect(token.length).toBeGreaterThan(10);
  });
});
