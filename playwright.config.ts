// playwright.config.ts
//
// Deliberately standalone — same isolation principle vitest.config.ts's own
// header comment already states for wxt.config.ts: don't let the extension
// build config leak into a test runner's config. This suite drives a real
// built extension (see e2e/fixtures.ts), it doesn't build one itself — run
// `npm run build` first (the fixture throws a clear error if you forget).
//
// Local-only for now: not wired into .github/workflows/ci.yml yet, so a
// flaky/failing e2e run never blocks a push/PR. Run with `npm run test:e2e`.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Extension tests share one persistent browser context's storage per
  // file (see e2e/fixtures.ts) — keep tests within a file sequential.
  fullyParallel: false,
  // Each test launches a full persistent Chromium context with the
  // extension loaded — heavier than a plain page, and launching several
  // concurrently was observed to make one worker's browser process
  // unresponsive (a `locator.waitFor: Target page, context or browser has
  // been closed` timeout) on an ordinary dev machine. One worker at a time
  // keeps the suite reliable; it's still only ~2s/test.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
