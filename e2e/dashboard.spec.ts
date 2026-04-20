import { expect, test } from './base';
import {
  API_BASE,
  ADMIN_PASSWORD,
  DEFAULT_SLUG,
  loginAdminApi,
} from './helpers';

/**
 * El endpoint de dashboard devuelve las ventanas (today/week/month) + asistencia + top
 * clientes, y el panel lo renderiza encima de la lista de turnos.
 */
test.describe('Dashboard admin', () => {
  test('GET /admin/dashboard responde con el shape esperado', async () => {
    const token = await loginAdminApi(DEFAULT_SLUG);
    const res = await fetch(`${API_BASE}/shops/${DEFAULT_SLUG}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      timezone: string;
      today: { appointments: number; revenueCents: number };
      week: { appointments: number; revenueCents: number };
      month: { appointments: number; revenueCents: number };
      attendance: { past: number; attended: number; ratePct: number | null };
      repeatCustomers: Array<{ customerId: string; totalAppointments: number }>;
    };
    expect(typeof data.timezone).toBe('string');
    for (const w of [data.today, data.week, data.month]) {
      expect(typeof w.appointments).toBe('number');
      expect(w.appointments).toBeGreaterThanOrEqual(0);
      expect(typeof w.revenueCents).toBe('number');
      expect(w.revenueCents).toBeGreaterThanOrEqual(0);
    }
    expect(Array.isArray(data.repeatCustomers)).toBeTruthy();
  });

  test('tab Turnos del admin muestra la sección Resumen', async ({ page }) => {
    await page.goto(`/s/${DEFAULT_SLUG}/admin`);
    await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);

    const dashboardWait = page.waitForResponse(
      (r) =>
        /\/api\/shops\/[^/]+\/admin\/dashboard$/.test(r.url()) &&
        r.request().method() === 'GET' &&
        r.ok(),
    );
    await page.getByRole('button', { name: 'Entrar' }).click();
    await dashboardWait;

    await expect(
      page.getByRole('heading', { name: 'Resumen' }),
    ).toBeVisible();
    await expect(page.getByText('Hoy', { exact: true })).toBeVisible();
    await expect(page.getByText('Esta semana')).toBeVisible();
    await expect(page.getByText('Este mes')).toBeVisible();
    await expect(page.getByText(/Asistencia/i)).toBeVisible();
    await expect(page.getByText(/Clientes recurrentes/i)).toBeVisible();
  });
});
