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

// WXT's stable, flat output filenames for each unlisted-page entrypoint —
// see shared/pages.ts, which can't be imported here directly since it calls
// browser.runtime.getURL() and only exists inside an extension page context,
// not this Node-side Playwright process.
export const PAGES = {
  settings: "settings.html",
  syncData: "sync-data.html",
  report: "report.html",
  members: "members.html",
  clubReview: "club-review.html",
} as const;

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  pageUrl: (page: (typeof PAGES)[keyof typeof PAGES]) => string;
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
  await page.goto(pageUrl(PAGES.settings));
  await page.locator(".option-card", { hasText: "Try with demo data" }).click();

  await page.goto(pageUrl(PAGES.syncData));
  await page.locator("#scrapeBasecampBtn").click();
  await page.locator("#scrapeEasySpeakBtn").click();
  // Exact match matters: the not-yet-imported badge text is "Not Imported",
  // which itself contains "Imported" as a substring.
  await page.locator("#badgeBasecamp", { hasText: /^Imported$/ }).waitFor();
  await page.locator("#badgeEasySpeak", { hasText: /^Imported$/ }).waitFor();
}
