// e2e/visual.spec.ts
//
// Visual-regression baseline for the Tailwind 4 + DaisyUI redesign
// (redesign/tailwind4-daisyui). Seeds demo data, then screenshots every
// app route + the popup at a desktop and a mobile viewport. Baselines are
// committed; the redesign branch regenerates and the diff is reviewed by a
// human — this is the only automated guard against visual regressions in the
// big-bang rewrite (there is no other visual-diff suite and no Firefox e2e).
//
// Regenerate baselines: `npm run build && npx playwright test visual --update-snapshots`

import { PAGES, seedDemoData, test, expect } from "./fixtures";

// Snapshots are OS-specific (rendered `*-win32.png` here) and this suite is a
// local human-review tool for the redesign branch, not a CI gate — skip it on
// CI so a Linux runner doesn't fail on missing/!matching platform snapshots.
test.skip(!!process.env.CI, "visual baseline is a local redesign tool, not a CI check");

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

const ROUTES: { name: string; page: (typeof PAGES)[keyof typeof PAGES] }[] = [
  { name: "dashboard", page: PAGES.dashboard },
  { name: "setup", page: PAGES.setup },
  { name: "syncData", page: PAGES.syncData },
  { name: "report", page: PAGES.report },
  { name: "members", page: PAGES.members },
  { name: "clubReview", page: PAGES.clubReview },
  { name: "exporter", page: PAGES.exporter },
];

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const { name, page: pagePath } of ROUTES) {
    test(`${name} @ ${vpName}`, async ({ page, pageUrl }) => {
      await seedDemoData(page, pageUrl);
      await page.setViewportSize(viewport);
      await page.goto(pageUrl(pagePath));
      await page.waitForLoadState("networkidle");
      // Let fonts settle / any storage.onChanged re-render finish.
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`${name}-${vpName}.png`, {
        fullPage: true,
        animations: "disabled",
        // Views show extraction timestamps / "updated just now" — allow a small
        // ratio so that volatile text doesn't fail an otherwise-stable layout.
        maxDiffPixelRatio: 0.02,
      });
    });
  }
}

test(`globalSettings @ desktop`, async ({ page, pageUrl }) => {
  await seedDemoData(page, pageUrl);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(pageUrl("app.html#globalSettings" as (typeof PAGES)[keyof typeof PAGES]));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("globalSettings-desktop.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.02 });
});

test(`whatsNew @ desktop`, async ({ page, pageUrl }) => {
  await seedDemoData(page, pageUrl);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(pageUrl("app.html#whatsNew" as (typeof PAGES)[keyof typeof PAGES]));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("whatsNew-desktop.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.02 });
});

test(`popup @ default`, async ({ page, pageUrl }) => {
  await seedDemoData(page, pageUrl);
  await page.setViewportSize({ width: 420, height: 640 });
  await page.goto(pageUrl("popup.html" as (typeof PAGES)[keyof typeof PAGES]));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("popup-default.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.02 });
});
