// e2e/sync-data-export.spec.ts
//
// Covers the flow that was hardest to verify without a real browser: Setup
// → Demo data → Sync Data → import both sources → the Export card's
// selector (availability/auto-select) and an actual file download.

import { PAGES, seedDemoData, test, expect } from "./fixtures";

test("Export card auto-selects All data, and lets you switch + download", async ({ context, pageUrl }) => {
  const page = await context.newPage();
  await seedDemoData(page, pageUrl);

  await page.goto(pageUrl(PAGES.syncData));

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
