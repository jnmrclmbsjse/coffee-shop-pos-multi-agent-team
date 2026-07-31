import { defineConfig, devices } from '@playwright/test';

/**
 * QA-owned Playwright config for the administrator sign-in story (#3).
 *
 * The repo-root config pins the web app to 127.0.0.1:5173, but on this
 * machine port 5173 is held by an unrelated container and the project's
 * Vite dev server falls back to 5174. The API only allows CORS origins
 * listed in WEB_ORIGIN (localhost:5173/5174/5175), so the browser must
 * load the app from a `localhost` origin on one of those ports. We target
 * the already-running dev servers (web on 5174, API on 3000) and reuse
 * them; the `command` fallbacks only run if a server is not reachable.
 *
 * The web and the API must be reached over the SAME host name. The session is
 * an httpOnly SameSite=Lax cookie set by the API, so a page served from
 * `localhost` fetching an API on `127.0.0.1` is cross-site and the browser
 * withholds the cookie — sign-in appears to succeed and every guarded route
 * then bounces. The Vite dev server is therefore started on whatever host
 * `E2E_WEB_URL` names rather than a hard-coded one (`--host localhost` binds
 * `::1` only, which `127.0.0.1` cannot reach).
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const WEB_BASE_URL = process.env.E2E_WEB_URL ?? `http://localhost:${WEB_PORT}`;
const WEB_HOST = new URL(WEB_BASE_URL).hostname;
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: '.',
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
