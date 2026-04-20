import { expect, test } from './base';
import {
  API_BASE,
  DEFAULT_SLUG,
  SYSTEM_ADMIN_PASSWORD,
  restoreDefaultToActive,
} from './helpers';

test.describe('Panel del sistema', () => {
  test.afterEach(async () => {
    await restoreDefaultToActive();
  });

  test('login rechaza credenciales incorrectas', async ({ page }) => {
    await page.goto('/system/login');
    await expect(
      page.getByRole('heading', { name: 'Panel del sistema' }),
    ).toBeVisible();

    await page.getByLabel('Contraseña').fill('no-es-la-password');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(
      page.getByText('credenciales incorrectas'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('suspend / unsuspend del local demo bloquea y habilita la URL pública', async ({
    page,
  }) => {
    await page.goto('/system/login');
    await page.getByLabel('Contraseña').fill(SYSTEM_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();

    // La tabla del panel del sistema debería listar al menos la demo.
    await expect(page).toHaveURL(/\/system$/, { timeout: 10_000 });
    const row = page.locator('tr', { hasText: `/${DEFAULT_SLUG}` });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Suspender la shop: el select de estado en la misma fila.
    const patchSuspend = page.waitForResponse(
      (r) =>
        /\/api\/system\/shops\/[^/]+\/status$/.test(r.url()) &&
        r.request().method() === 'PATCH' &&
        r.ok(),
    );
    await row.locator('select').selectOption('suspended');
    await patchSuspend;
    await expect(row.locator('select')).toHaveValue('suspended');

    // La URL pública debería pasar a 404. Verificamos con el endpoint
    // `public-settings` porque es lo que consume la UI antes de renderizar.
    const publicSuspendedRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/public-settings`,
    );
    expect(publicSuspendedRes.status).toBe(404);

    // Rehabilitar: volver a `active`.
    const patchActive = page.waitForResponse(
      (r) =>
        /\/api\/system\/shops\/[^/]+\/status$/.test(r.url()) &&
        r.request().method() === 'PATCH' &&
        r.ok(),
    );
    await row.locator('select').selectOption('active');
    await patchActive;
    await expect(row.locator('select')).toHaveValue('active');

    const publicActiveRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/public-settings`,
    );
    expect(publicActiveRes.status).toBe(200);
  });
});
