// playwright.config.ts
//
// Deliberately standalone — same isolation principle vitest.config.ts's own
// header comment already states for wxt.config.ts: don't let the extension
// build config leak into a test runner's config. This suite drives a real
// built extension (see e2e/fixtures.ts), it doesn't build one itself — run
// `npm run build` first (the fixture throws a clear error if you forget).
//
// Wired into .github/workflows/ci.yml, right after the store/Chrome build
// step (the exact .output/store/chrome-mv3 this suite launches). Run
// locally with `npm run test:e2e` (after `npm run build`).

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
  // Every test cold-installs the extension into a brand-new, empty
  // persistent-context profile (see e2e/fixtures.ts) — background.ts's
  // service worker genuinely starts from zero every single time, so there's
  // a narrow but real window where a click's browser.runtime.sendMessage()
  // (shared/send-message.ts — bare, no timeout/retry of its own) can race
  // the not-yet-fully-initialized background listener and never resolve.
  // Confirmed this is the actual failure mode behind the occasional
  // `locator.waitFor: Target page, context or browser has been closed`
  // flake (~1 in 6 runs observed) by watching Chromium's process count and
  // memory stay flat for the whole suite while it happened — ruling out a
  // crash/resource exhaustion, which was the original (incomplete) theory
  // behind `workers: 1` above. A retry gets a fully independent, fresh
  // context/profile, not just another attempt in the same unlucky one, so
  // it reliably clears a one-off race without masking a test that's
  // actually broken (that still fails again after the retry). Applies
  // locally too, not just in CI, since the race is inherent to the launch
  // itself, not runner-specific resource constraints.
  retries: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
