// Keep the repository-root Playwright entry point for `pnpm e2e`, while making
// the QA-owned configuration under e2e/ the single source of truth. In
// particular, that config uses one worker because the specs share and reset a
// persistent database, and it keeps the web/API host names aligned so the
// SameSite session cookie is sent consistently.
export { default } from './e2e/playwright.config';
