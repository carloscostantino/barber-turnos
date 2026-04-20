import { expect, test } from './base';
import {
  ADMIN_PASSWORD,
  API_BASE,
  DEFAULT_SLUG,
  createAppointmentApi,
  findReservableSlot,
  loginAdminApi,
} from './helpers';

/**
 * Cobertura de punta a punta de la operatoria de turnos:
 *   1) Reserva pública vía API (`POST /api/shops/:slug/appointments`) usando
 *      un slot real del shop demo. Evitamos la UI pública en este test para
 *      no depender del día de la semana y de la disponibilidad de slots para
 *      "hoy"; la cobertura de la UI ya la dan `booking.spec.ts` y
 *      `home.spec.ts` (availability + render del form de reserva).
 *   2) Login en el panel admin desde el UI (`/s/:slug/admin`).
 *   3) Cancelación desde el UI: abre el modal "Cancelar turno" y confirma.
 *   4) Verificación server-side: el turno quedó `cancelled` cuando se
 *      vuelve a listar `/api/shops/:slug/admin/appointments`.
 */
test.describe('Reserva + cancelación desde admin', () => {
  test('turno creado por API se cancela desde el panel admin', async ({
    page,
  }) => {
    const customerName = `E2E Cliente ${Date.now().toString(36).slice(-6)}`;
    const customerEmail = `e2e-${Date.now().toString(36).slice(-6)}@example.test`;

    const { service, slot } = await findReservableSlot(DEFAULT_SLUG);
    const appt = await createAppointmentApi(DEFAULT_SLUG, {
      serviceId: service.id,
      startsAt: slot.startsAt,
      customer: {
        name: customerName,
        phone: '11 5555-0000',
        email: customerEmail,
      },
    });
    expect(appt.id).toBeTruthy();

    // --------- UI admin: login y cancelar ---------
    await page.goto(`/s/${DEFAULT_SLUG}/admin`);
    await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);

    const appointmentsWait = page.waitForResponse(
      (r) =>
        /\/api\/shops\/[^/]+\/admin\/appointments/.test(r.url()) &&
        r.request().method() === 'GET' &&
        r.ok(),
    );
    await page.getByRole('button', { name: 'Entrar' }).click();
    await appointmentsWait;

    // El panel puede filtrar por rango; si el slot está en los próximos días
    // va a aparecer. Buscamos por el nombre único del cliente.
    await expect(
      page.getByText(customerName).first(),
    ).toBeVisible({ timeout: 20_000 });

    const appointmentCard = page
      .locator('article, li, tr, div')
      .filter({ hasText: customerName })
      .first();
    await appointmentCard
      .getByRole('button', { name: /^Cancelar$/ })
      .first()
      .click();

    // Modal "Cancelar turno" → "Confirmar cancelación".
    await expect(
      page.getByRole('heading', { name: 'Cancelar turno' }),
    ).toBeVisible({ timeout: 5_000 });

    const cancelP = page.waitForResponse(
      (r) =>
        /\/api\/shops\/[^/]+\/admin\/appointments\/[^/]+\/status$/.test(r.url()) &&
        r.request().method() === 'PATCH',
    );
    await page
      .getByRole('button', { name: 'Confirmar cancelación' })
      .click();
    const cancelRes = await cancelP;
    expect(cancelRes.ok()).toBeTruthy();

    // Verificación server-side.
    const token = await loginAdminApi(DEFAULT_SLUG);
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const listRes = await fetch(
      `${API_BASE}/shops/${DEFAULT_SLUG}/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(listRes.status).toBe(200);
    const rows = (await listRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    const mine = rows.find((r) => r.id === appt.id);
    expect(mine?.status).toBe('cancelled');
  });
});
