// e2e/pages-render.spec.ts
//
// Lightweight smoke check: once demo data is seeded, Report/Members/Club
// Review should each render without throwing a console error, and each
// page's own content root should actually have something in it (not just
// an empty shell after renderAppShell() runs).

import { PAGES, seedDemoData, test, expect } from "./fixtures";

const PAGES_TO_CHECK: { name: string; page: (typeof PAGES)[keyof typeof PAGES]; contentRootSelector: string }[] = [
  { name: "Club Progress", page: PAGES.report, contentRootSelector: "#clubTabs" },
  { name: "Member Review", page: PAGES.members, contentRootSelector: "#clubTabs" },
  { name: "Club Review", page: PAGES.clubReview, contentRootSelector: "#clubLookupRoot" },
];

for (const { name, page: pagePath, contentRootSelector } of PAGES_TO_CHECK) {
  test(`${name} renders demo data without console errors`, async ({ page, pageUrl }) => {
    await seedDemoData(page, pageUrl);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(pageUrl(pagePath));
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#appShell")).not.toBeEmpty();
    await expect(page.locator(contentRootSelector)).not.toBeEmpty();
    expect(consoleErrors).toEqual([]);
  });
}
