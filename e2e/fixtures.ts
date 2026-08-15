// e2e/fixtures.ts
//
// Launches the real built extension (.output/store/chrome-mv3 — the same
// "pick this if in doubt" build CLAUDE.md's own manual-testing instructions
// call out) in a persistent Chromium context, the way a human tester would
// via chrome://extensions "Load unpacked". This file owns exactly two
// things: the launch fixture, and seedDemoData() — the one click-sequence
// every spec needs to get renderable data into storage with zero network
// calls (see shared/settings-store.ts's "demo" profile /
// background/api/basecamp.ts & background/api/easyspeak.ts's demo
// short-circuit).
//
// Deliberately doesn't build the extension itself — run `npm run build`
// first (this file throws a clear error below if you forget), matching how
// `npm test` (Vitest) is likewise never responsible for building anything.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/store/chrome-mv3");

// The 5 wizard steps are all client-side routes inside the single merged
// entrypoints/app/ (app.html), addressed by hash fragment — see
// shared/pages.ts's AppRoute/appRouteUrl, which can't be imported here
// directly since shared/pages.ts calls browser.runtime.getURL() and only
// exists inside an extension page context, not this Node-side Playwright
// process.
export const PAGES = {
  setup: "app.html#setup",
  syncData: "app.html#syncData",
  report: "app.html#report",
  members: "app.html#members",
  clubReview: "app.html#clubReview",
} as const;

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  pageUrl: (page: (typeof PAGES)[keyof typeof PAGES]) => string;
  page: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
      throw new Error(`No built extension found at ${EXTENSION_PATH} — run \`npm run build\` first.`);
    }

    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        // Chrome only loads unpacked extensions in "new" headless mode
        // (pre-112 headless couldn't load extensions at all).
        "--headless=new",
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },

  pageUrl: async ({ extensionId }, use) => {
    await use((page) => `chrome-extension://${extensionId}/${page}`);
  },

  // Overrides Playwright's built-in `page` fixture (which would otherwise
  // just do a plain context.newPage()) to also clean up dead weight: a
  // brand-new, empty user-data-dir means the extension's onInstalled
  // "install" listener (entrypoints/background.ts) fires on every single
  // test, opening a welcome.html tab nothing here exercises, on top of the
  // context's own initial blank tab. Every test already launches/tears down
  // a full persistent Chromium + extension process — closing the extra tabs
  // keeps each one as light as possible, which matters for this suite's
  // reliability (a `Target page, context or browser has been closed` flake
  // was traced back to resource pressure from these heavy launches).
  page: async ({ context }, use) => {
    const page = await context.newPage();
    for (let i = 0; i < 10 && context.pages().length < 2; i++) {
      await page.waitForTimeout(50);
    }
    for (const p of context.pages()) {
      if (p !== page) await p.close().catch(() => {});
    }
    await use(page);
  },
});

export const expect = test.expect;

/**
 * Drives the real UI (not a direct storage write) to get demo-profile data
 * into browser.storage.local:
 *  1. Setup → select "Try with demo data".
 *  2. Sync Data → import both sources (background short-circuits straight to
 *     shared/mock/mockData.ts's fixtures for the "demo" profile — no
 *     network/tab/login involved).
 */
export async function seedDemoData(page: Page, pageUrl: (page: (typeof PAGES)[keyof typeof PAGES]) => string): Promise<void> {
  await page.goto(pageUrl(PAGES.setup));
  await page.locator(".option-card", { hasText: "Try with demo data" }).click();

  await page.goto(pageUrl(PAGES.syncData));
  await page.locator("#scrapeBasecampBtn").click();
  await page.locator("#scrapeEasySpeakBtn").click();
  // Exact match matters: the not-yet-imported badge text is "Not Imported",
  // which itself contains "Imported" as a substring.
  await page.locator("#badgeBasecamp", { hasText: /^Imported$/ }).waitFor();
  await page.locator("#badgeEasySpeak", { hasText: /^Imported$/ }).waitFor();
}
