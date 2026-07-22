# End-to-end tests

QA-owned Playwright specifications belong in this directory. The root
`playwright.config.ts` starts both the NestJS API and Vite web app and runs the
suite against Chromium. No product behavior is asserted by the bootstrap.
