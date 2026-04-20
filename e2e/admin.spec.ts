import { expect, test } from './base';

const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? 'admin12345';

test.describe('Panel admin', () => {
  test('login y listado de turnos (GET /api/shops/:slug/admin/appointments)', async ({
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

    // Las rutas admin ahora cuelgan de /api/shops/:slug/admin/... para que el
    // middleware server-side valide que el JWT corresponde a la shop de la URL.
    const appointmentsWait = page.waitForResponse(
      (res) =>
        /\/api\/shops\/default\/admin\/appointments/.test(res.url()) &&
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
