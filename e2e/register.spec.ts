import { expect, test } from './base';

/**
 * Registra una barbería nueva desde el UI público (`/register`) y verifica:
 *   1) el POST `/api/shops/register` responde 201 con el slug y `checkoutUrl` (o null).
 *   2) la pantalla de éxito muestra el link a `/s/<slug>`.
 *   3) navegar a `/s/<slug>` ya funciona (la shop existe como local público).
 *
 * Usa un slug único basado en `Date.now()` para no ensuciar datos entre corridas
 * ni depender de migraciones específicas del seed.
 */
test.describe('Alta de barbería', () => {
  test('registro crea la shop y su URL pública queda disponible', async ({
    page,
  }) => {
    const unique = Date.now().toString(36).slice(-6);
    const shopName = `E2E Barberia ${unique}`;
    const slug = `e2e-${unique}`;
    const ownerEmail = `owner-${unique}@example.test`;
    const ownerPassword = 'owner-e2e-12345';

    await page.goto('/register');

    await expect(
      page.getByRole('heading', { name: 'Alta de barbería' }),
    ).toBeVisible();

    await page.getByLabel('Nombre del local').fill(shopName);
    // El slug se autocompleta desde el nombre, pero sobreescribimos con el
    // determinístico para poder buscarlo exactamente después.
    await page.getByLabel('Identificador (URL)').fill(slug);
    await page.getByLabel('Tu email (dueño)').fill(ownerEmail);
    await page.getByLabel('Contraseña', { exact: true }).fill(ownerPassword);

    const registerP = page.waitForResponse(
      (r) =>
        /\/api\/shops\/register$/.test(r.url()) &&
        r.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Crear mi barbería' }).click();

    const registerRes = await registerP;
    expect(registerRes.status()).toBe(201);
    const registerBody = (await registerRes.json()) as {
      slug?: string;
      checkoutUrl?: string | null;
    };
    expect(registerBody.slug).toBe(slug);

    await expect(
      page.getByRole('heading', { name: '¡Listo!' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: `/s/${slug}` })).toBeVisible();

    // La shop recién creada tiene que contestar `public-settings` OK, y la
    // página pública renderizar el nombre elegido en el h1.
    const publicSettingsP = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/shops/${slug}/public-settings`) && r.ok(),
    );

    await page.goto(`/s/${slug}`);
    const settingsRes = await publicSettingsP;
    const settings = (await settingsRes.json()) as {
      shopName?: string | null;
    };
    expect(settings.shopName?.trim()).toBe(shopName);

    await expect(
      page.getByRole('heading', { level: 1, name: shopName }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
