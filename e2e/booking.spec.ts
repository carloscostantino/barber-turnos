import { expect, test } from './base';

test.describe('Disponibilidad', () => {
  test('GET /api/availability responde 200 con slots', async ({ page }) => {
    const servicesP = page.waitForResponse(
      (r) => r.url().includes('/api/services') && r.ok(),
    );
    const settingsP = page.waitForResponse(
      (r) => r.url().includes('/api/public-settings') && r.ok(),
    );
    await page.goto('/');
    await Promise.all([servicesP, settingsP]);

    await expect(
      page.getByRole('button', { name: 'Actualizar horarios' }),
    ).toBeEnabled({ timeout: 15_000 });

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/availability') &&
        res.request().method() === 'GET' &&
        res.ok(),
    );

    await page.getByRole('button', { name: 'Actualizar horarios' }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const data = (await response.json()) as { slots: unknown[] };
    expect(data).toHaveProperty('slots');
    expect(Array.isArray(data.slots)).toBe(true);
  });
});
