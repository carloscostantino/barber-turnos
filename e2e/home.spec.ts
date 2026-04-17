import { expect, test } from './base';

const DEFAULT_SLUG = process.env.E2E_DEFAULT_SHOP_SLUG ?? 'default';

test.describe('Landing', () => {
  test('muestra la home con CTA a registro y demo', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /Turnos online/ }),
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: 'Crear mi barbería' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Ver demo de reservas' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Ver demo de reservas' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${DEFAULT_SLUG}`));
  });
});

test.describe('Reserva pública (demo)', () => {
  test('muestra la pantalla de reservas del tenant demo', async ({ page }) => {
    await page.goto(`/s/${DEFAULT_SLUG}`);

    await expect(
      page.getByRole('link', { name: 'Panel admin' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reservar' })).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Horarios disponibles' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Confirmar turno' }),
    ).toBeVisible();
  });
});
