import { expect, test } from './base';

test.describe('Reserva pública', () => {
  test('muestra la pantalla principal', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Panel admin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reservar' })).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Horarios disponibles' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Confirmar turno' }),
    ).toBeVisible();
  });
});
