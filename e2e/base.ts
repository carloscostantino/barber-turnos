import { test as base } from '@playwright/test';

/**
 * Limpia sessionStorage antes de cada navegación para no arrastrar JWT de otros runs.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
