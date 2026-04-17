import { expect, test } from './base';

const DEFAULT_SLUG = process.env.E2E_DEFAULT_SHOP_SLUG ?? 'default';

test.describe('Disponibilidad', () => {
  test('GET /api/availability responde 200 con slots', async ({ page }) => {
    const servicesP = page.waitForResponse(
      (r) =>
        r.url().includes('/api/shops/') &&
        r.url().includes('/services') &&
        r.ok(),
    );
    const settingsP = page.waitForResponse(
      (r) =>
        r.url().includes('/api/shops/') &&
        r.url().includes('/public-settings') &&
        r.ok(),
    );
    await page.goto(`/s/${DEFAULT_SLUG}`);
    await Promise.all([servicesP, settingsP]);

    const response = await page.waitForResponse(
      (res) =>
        res.url().includes('/api/shops/') &&
        res.url().includes('/availability') &&
        res.request().method() === 'GET' &&
        res.ok(),
      { timeout: 20_000 },
    );

    expect(response.status()).toBe(200);
    const data = (await response.json()) as { slots: unknown[] };
    expect(data).toHaveProperty('slots');
    expect(Array.isArray(data.slots)).toBe(true);
  });

  test('reserva muestra nombre del local (public-settings incluye shopName)', async ({
    page,
  }) => {
    const settingsP = page.waitForResponse(
      (r) =>
        r.url().includes('/api/shops/') &&
        r.url().includes('/public-settings') &&
        r.ok(),
    );
    await page.goto(`/s/${DEFAULT_SLUG}`);
    const res = await settingsP;
    const json = (await res.json()) as { shopName?: string | null };
    expect(json).toHaveProperty('shopName');
    const title = json.shopName?.trim() || 'Turnos Barbería';
    await expect(
      page.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
