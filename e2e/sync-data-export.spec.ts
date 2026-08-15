// e2e/sync-data-export.spec.ts
//
// Covers the flow that was hardest to verify without a real browser: Setup
// → Demo data → Sync Data → import both sources → the Export card's
// selector (availability/auto-select) and an actual file download.

import { PAGES, seedDemoData, test, expect } from "./fixtures";

test("Export card auto-selects All data, and lets you switch + download", async ({ page, pageUrl }) => {
  await seedDemoData(page, pageUrl);

  await page.goto(pageUrl(PAGES.syncData));
  await page.locator("#exportMenuBtn").click();

  const options = page.locator("#exportOptionsRoot .option-card");
  await expect(options).toHaveCount(3);
  const classNames = await options.evaluateAll((els) => els.map((el) => el.className));
  expect(classNames.some((c) => c.includes("disabled"))).toBe(false); // both sources loaded

  const allOption = options.filter({ hasText: "All data" });
  const basecampOption = options.filter({ hasText: "Basecamp" });
  await expect(allOption).toHaveClass(/selected/);
  await expect(allOption.locator('input[type="radio"]')).toBeChecked();

  const exportBtn = page.locator("#exportExcelBtn");
  await expect(exportBtn).toBeEnabled();

  // Switch the selection — covers renderExportOptions()'s re-render-on-change path.
  await basecampOption.click();
  await expect(basecampOption).toHaveClass(/selected/);
  await expect(allOption).not.toHaveClass(/selected/);

  const [download] = await Promise.all([page.waitForEvent("download"), exportBtn.click()]);

  expect(download.suggestedFilename()).toMatch(/^toastmasters-export-basecamp-\d{4}-\d{2}-\d{2}\.xlsx$/);

  const statusExport = page.locator("#statusExport");
  await expect(statusExport).toContainText("✓ Exported");
  await expect(statusExport.locator("ins")).toHaveText(download.suggestedFilename());

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
});

test("upgrades the automatic fallback pick to All data once it becomes available", async ({ page, pageUrl }) => {
  // Reproduces importing sources one at a time (the natural left-to-right
  // click order), not seedDemoData()'s near-simultaneous double click — that
  // shortcut happens to skip the intermediate "only Basecamp loaded" state
  // this test exists to cover.
  await page.goto(pageUrl(PAGES.setup));
  await page.locator(".option-card", { hasText: "Try with demo data" }).click();
  await page.goto(pageUrl(PAGES.syncData));
  await page.locator("#exportMenuBtn").click();

  const options = page.locator("#exportOptionsRoot .option-card");
  const allOption = options.filter({ hasText: "All data" });
  const basecampOption = options.filter({ hasText: "Basecamp" });

  await page.locator("#scrapeBasecampBtn").click();
  await page.locator("#badgeBasecamp", { hasText: /^Imported$/ }).waitFor();

  // Only Basecamp is loaded — "All data" isn't available, so the automatic
  // fallback picks the one option that is.
  await expect(basecampOption).toHaveClass(/selected/);

  await page.locator("#scrapeEasySpeakBtn").click();
  await page.locator("#badgeEasySpeak", { hasText: /^Imported$/ }).waitFor();

  // Now that both sources are loaded, the automatic pick should upgrade to
  // "All data" rather than staying stuck on the earlier fallback.
  await expect(allOption).toHaveClass(/selected/);
  await expect(basecampOption).not.toHaveClass(/selected/);
});

test("does not override a manual pick on a later refresh", async ({ page, pageUrl }) => {
  await seedDemoData(page, pageUrl);
  await page.goto(pageUrl(PAGES.syncData));
  await page.locator("#exportMenuBtn").click();

  const options = page.locator("#exportOptionsRoot .option-card");
  const allOption = options.filter({ hasText: "All data" });
  const basecampOption = options.filter({ hasText: "Basecamp" });

  // Both sources are already loaded, so "All data" starts selected — switch
  // away from it manually (a real state change, unlike re-clicking an
  // already-checked radio, which fires no "change" event at all).
  await basecampOption.click();
  await expect(basecampOption).toHaveClass(/selected/);

  // Trigger another refresh() the way re-importing a source would (a
  // browser.storage.onChanged event) — the manual pick must survive it,
  // not get silently upgraded back to "All data". #scrapeBasecampBtn is now
  // the "Re-import data" link (see renderSourceCard()), still the same id.
  await page.locator("#scrapeBasecampBtn").click();
  await page.waitForTimeout(300); // demo re-import + refresh() settle

  await expect(basecampOption).toHaveClass(/selected/);
  await expect(allOption).not.toHaveClass(/selected/);
});
