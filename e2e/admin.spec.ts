import { expect, test } from './base';

const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? 'admin12345';

test.describe('Panel admin', () => {
  test('login y listado de turnos (GET /api/appointments)', async ({
    page,
  }) => {
    await page.goto('/s/default/admin');

    // El h1 del login puede ser "Panel admin" (sin shopName) o "Hola, {nombre}"
    // cuando el shop tiene nombre configurado. Usamos regex para no atarnos al seed.
    const loginTitle = page.getByRole('heading', {
      level: 1,
      name: /^(Hola,\s.+|Panel admin)$/,
    });

    if (await page.getByRole('button', { name: 'Cerrar sesión' }).isVisible()) {
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(loginTitle).toBeVisible({ timeout: 10_000 });
    }

    await expect(loginTitle).toBeVisible({ timeout: 15_000 });

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

    // El h1 del panel autenticado sigue el mismo patrón que el login
    // ("Hola, {nombre}" o "Panel admin" como fallback). El subtítulo
    // ("Panel de administración · ...") se queda como <p>.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /^(Hola,\s.+|Panel admin)$/,
      }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByRole('button', { name: 'Cerrar sesión' }),
    ).toBeVisible();
  });
});
