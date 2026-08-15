// src/shared/app-tab.ts
//
// Finds an already-open tab showing the merged app (src/entrypoints/app/),
// regardless of which route/hash it's currently on, and focuses+navigates
// it instead of opening a duplicate — used by the popup's gear icon and
// vertical-stepper clicks (entrypoints/popup/main.ts). browser.tabs.*/
// browser.windows.*-dependent, so this lives under shared/ following the
// same established exception as storage.ts/settings-store.ts/
// sync-status-panel.ts/update-store.ts/countdown.ts (see the shared/** ⇏
// background/** layering rule) rather than under background/ — the popup
// calls this directly, no background-lifetime constraint applies here, same
// reasoning already applied to Member/Club Review's direct
// resolution-store writes bypassing background entirely.

import { PAGES, pageUrl, appRouteUrl, type AppRoute } from "./pages";

/**
 * Focuses an existing tab already showing the merged app (on any route) and
 * navigates it to `route`; opens a new tab if none is found.
 *
 * A fragment-only browser.tabs.update() is expected to fire a same-document
 * hashchange in the target tab rather than a full reload — but even if some
 * browser/version reloads instead, it's not a correctness bug: the app
 * shell's own navigate(location.hash) call at module load re-resolves the
 * right route either way, so at most it costs an extra reload flash, never
 * a wrong destination.
 */
export async function focusOrOpenAppTab(route: AppRoute): Promise<void> {
  const base = pageUrl(PAGES.app);
  // Wildcarded since browser.tabs.query's url pattern matches the full URL
  // including fragment — an exact-match query would miss a tab sitting on a
  // different route.
  const [existing] = await browser.tabs.query({ url: `${base}*` });

  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { url: appRouteUrl(route), active: true });
    if (existing.windowId !== undefined) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: appRouteUrl(route) });
}
