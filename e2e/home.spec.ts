import { expect, test } from './base';

test.describe('Reserva pública', () => {
  test('muestra la pantalla principal', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Turnos Barbería' }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Panel admin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reservar' })).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Actualizar horarios' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirmar turno' }),
    ).toBeVisible();
  });
});
