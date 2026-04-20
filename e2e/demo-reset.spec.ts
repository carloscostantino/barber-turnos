import { expect, test } from './base';
import { API_BASE, DEFAULT_SLUG, loginAdminApi } from './helpers';

/** Nombre que setea `resetDemoShop()` al restaurar. */
const DEMO_DEFAULT_NAME = 'Barbería demo';

/**
 * Verifica que hacer click en "Ver demo de reservas" desde la home dispara
 * `POST /api/demo/reset` y deja la shop demo con sus valores por defecto,
 * incluso si algún usuario previo cambió el nombre del local.
 */
test.describe('Demo reset', () => {
  test('click en "Ver demo de reservas" reinicia el nombre del local', async ({
    page,
  }) => {
    // Login admin por API para setear un nombre claramente "modificado" en el
    // demo (más rápido y robusto que hacer click por todo el panel).
    const token = await loginAdminApi(DEFAULT_SLUG);

    const dirtyName = `DEMO MODIFICADO ${Date.now().toString(36).slice(-4)}`;
    const putRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/shop-settings`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingMinLeadHours: 2,
          bookingMaxDaysAhead: 15,
          shopName: dirtyName,
          contactWhatsapp: null,
          contactEmail: null,
          contactAddress: null,
          addressStreet: null,
          addressNumber: null,
          addressFloor: null,
          addressCity: null,
          addressRegion: null,
          addressPostalCode: null,
        }),
      },
    );
    expect(putRes.status).toBe(200);

    // Sanity check: public-settings ahora devuelve el nombre modificado.
    const modifiedPublic = (await (
      await fetch(`${API_BASE}/shops/${DEFAULT_SLUG}/public-settings`)
    ).json()) as { shopName?: string | null };
    expect(modifiedPublic.shopName).toBe(dirtyName);

    // Disparamos el demo reset desde la home, escuchando la respuesta.
    const resetP = page.waitForResponse(
      (r) =>
        /\/api\/demo\/reset$/.test(r.url()) &&
        r.request().method() === 'POST',
    );

    await page.goto('/');
    await page.getByRole('link', { name: 'Ver demo de reservas' }).click();
    const resetRes = await resetP;
    expect(resetRes.ok()).toBeTruthy();

    await expect(page).toHaveURL(new RegExp(`/s/${DEFAULT_SLUG}`));

    // Tras el reset el nombre del shop vuelve al default y el h1 lo muestra.
    await expect(
      page.getByRole('heading', { level: 1, name: DEMO_DEFAULT_NAME }),
    ).toBeVisible({ timeout: 15_000 });

    const restoredPublic = (await (
      await fetch(`${API_BASE}/shops/${DEFAULT_SLUG}/public-settings`)
    ).json()) as { shopName?: string | null };
    expect(restoredPublic.shopName).toBe(DEMO_DEFAULT_NAME);
  });
});
