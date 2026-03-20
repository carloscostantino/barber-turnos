import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: levanta API + Vite con `npm run dev` si no hay nada escuchando.
 * Requiere Postgres accesible (p. ej. `docker compose up -d db` y `server/.env`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Puerto 5174 para no chocar con Docker/Vite en 5173.
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:5174',
    env: {
      ...process.env,
      CLIENT_ORIGIN: 'http://127.0.0.1:5174',
      // API dedicada para E2E: no choca con Docker en 3001 ni con su CORS (5173).
      PORT: '3002',
      VITE_API_BASE: 'http://127.0.0.1:3002/api',
      // El servidor exige estas vars; si faltan en .env local, usamos valores solo para E2E.
      JWT_SECRET:
        process.env.JWT_SECRET ||
        'playwright-e2e-jwt-secret-min16chars',
      ADMIN_PASSWORD:
        process.env.ADMIN_PASSWORD ||
        process.env.E2E_ADMIN_PASSWORD ||
        'admin12345',
    },
    reuseExistingServer: process.env.PW_TEST_REUSE_SERVER === '1',
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
