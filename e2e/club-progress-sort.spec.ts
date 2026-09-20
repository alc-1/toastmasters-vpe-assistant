// e2e/club-progress-sort.spec.ts
//
// Regression test for a real, shipped bug: clicking a "Next Level Summary"
// column header on Club Progress (report.ts) looked like it worked (the
// sort-indicator arrow updated) but never actually reordered the rows.
// Root cause — every row's detail (the per-level "levels" table) is always
// rendered into the DOM, just collapsed via CSS, not removed — so an
// unscoped `querySelectorAll("table.summary th")` in updateSummaryHeaders()
// also matched that nested table's own <th>s (which carry no data-key),
// threw trying to read `.label` off the resulting `undefined` column
// lookup, and silently aborted before renderSummaryBody() — the function
// that actually re-sorts — ever ran. See report.ts's updateSummaryHeaders()
// and the click listener in renderSummaryTable() for the fix (both
// scoped to "table.summary > thead th" now).

import { PAGES, seedDemoData, test, expect } from "./fixtures";

test("Club Progress: clicking a Next Level Summary header sorts the rows", async ({ page, pageUrl }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await seedDemoData(page, pageUrl);
  await page.goto(pageUrl(PAGES.report));

  const memberCells = page.locator("#summaryTableRoot table.summary tbody tr[data-row-key] td:first-child");
  await memberCells.first().waitFor();

  const before = await memberCells.allTextContents();
  expect(before.length).toBeGreaterThan(1);

  await page.locator('#summaryTableRoot table.summary th[data-key="memberName"]').click();
  await expect(page.locator('#summaryTableRoot table.summary th[data-key="memberName"] .sort-indicator')).toBeVisible();

  const after = await memberCells.allTextContents();
  expect(after).not.toEqual(before);
  expect(pageErrors).toEqual([]);
});
