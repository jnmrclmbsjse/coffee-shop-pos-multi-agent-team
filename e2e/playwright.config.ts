import { defineConfig, devices } from '@playwright/test';

/**
 * Canonical Playwright config for the repository's browser tests.
 *
 * The web and the API must be reached over the SAME host name. The session is
 * an httpOnly SameSite=Lax cookie set by the API, so a page served from
 * `localhost` fetching an API on `127.0.0.1` is cross-site and the browser
 * withholds the cookie — sign-in appears to succeed and every guarded route
 * then bounces. The Vite dev server is therefore started on whatever host
 * `E2E_WEB_URL` names rather than a hard-coded one (`--host localhost` binds
 * `::1` only, which `127.0.0.1` cannot reach).
 */
// Keep the clean-checkout default aligned with the API's default WEB_ORIGIN.
// Developers using another port must set E2E_WEB_PORT/E2E_WEB_URL and include
// that origin in WEB_ORIGIN.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const WEB_BASE_URL = process.env.E2E_WEB_URL ?? `http://localhost:${WEB_PORT}`;
const WEB_HOST = new URL(WEB_BASE_URL).hostname;
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  // Resolve independently of which entry point loaded this config. The root
  // playwright.config.ts re-exports this object for `pnpm e2e`; a relative `.`
  // would otherwise become the repository root and Playwright would collect
  // Jest/Vitest/unit files (and nested agent worktrees) as browser tests.
  testDir: __dirname,
  fullyParallel: false,
  // `fullyParallel: false` only serialises tests *within* a file — Playwright
  // still runs different files concurrently across workers. That is not safe
  // here: several specs reset globally shared state that others depend on
  // (owner-reporting and order-history delete every trading day, staff-roster
  // empties the roster, and the business-day suite clears the whole trading-day
  // world before each test), and they all share one persistent dev database.
  // One worker is what actually makes the suite deterministic.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @coffee-shop/api dev',
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @coffee-shop/web dev --host ${WEB_HOST} --port ${WEB_PORT} --strictPort`,
      url: WEB_BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
