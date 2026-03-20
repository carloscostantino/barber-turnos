import { expect, test } from './base';

const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? 'admin12345';

test.describe('Panel admin', () => {
  test('login y listado de turnos (GET /api/appointments)', async ({
    page,
  }) => {
    await page.goto('/admin');

    if (await page.getByRole('button', { name: 'Cerrar sesión' }).isVisible()) {
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(
        page.getByRole('heading', { name: 'Panel admin' }),
      ).toBeVisible({ timeout: 10_000 });
    }

    await expect(
      page.getByRole('heading', { name: 'Panel admin' }),
    ).toBeVisible({ timeout: 15_000 });

    const appointmentsWait = page.waitForResponse(
      (res) =>
        res.url().includes('/api/appointments') &&
        res.request().method() === 'GET' &&
        res.ok(),
    );

    await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();

    const res = await appointmentsWait;
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as unknown[];
    expect(Array.isArray(rows)).toBe(true);

    await expect(
      page.getByRole('heading', { name: 'Panel de turnos' }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeVisible();
  });
});
