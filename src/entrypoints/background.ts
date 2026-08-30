// src/entrypoints/background.ts
//
// Background entrypoint. Handles scraping requests from the popup by calling
// the Basecamp and EasySpeak APIs (see background/api/basecamp.ts and
// background/api/easyspeak.ts). Basecamp needs no open tab at all:
// host_permissions authorizes fetch() from this privileged context to carry
// the user's session cookie. EasySpeak (whichever regional server is
// configured — see shared/settings-store.ts) sits behind Cloudflare, which
// blocks programmatic fetch()/XHR outright, so background/api/easyspeak.ts
// instead navigates a real tab and extracts data from its live DOM via
// browser.scripting (see entrypoints/easyspeak-parser.content.ts).
//
// Also owns the toolbar icon's loading/success/error state (see
// background/icon-state.ts) — kept here rather than in the popup because a
// scrape (especially EasySpeak, which closes the popup as soon as it
// starts) must keep updating the icon whether or not the popup that
// triggered it is still open.
//
// onInstalled also opens welcome.html in a new tab, but only on a fresh
// install (reason === "install", never "update" — an existing user
// reloading/upgrading the extension shouldn't see the first-run pin-me
// walkthrough again every time). Chrome doesn't pin a newly installed
// extension's toolbar icon by default, so without this the icon is invisible
// behind the puzzle-piece menu and there's nothing prompting the user to fix
// that.
//
// On "update", it no longer opens a What's New tab — "Strategy 3" for update
// notifications replaced that auto-launch with a quiet "What's New" link in
// the app footer (shared/whats-new-badge.ts + shared/app-shell.ts's
// renderAppFooter). All this handler does now is seed `lastViewedVersion` so
// that link's unread dot has a correct baseline: on a fresh install the user is already
// on the latest version (nothing unread); on an update, if no baseline
// exists yet (upgrading from a build that predates the badge) it's seeded
// from `previousVersion` so the dot lights up for the release just installed.
// An existing baseline is left untouched.
// NOTE: Chrome fires onInstalled/"update" on essentially every extension
// reload during local unpacked/temporary-install dev (same quirk
// background/api/update-checker.ts lives with); the seed logic is a no-op on
// a repeat fire, so that's harmless here.
//
// The store-vs-preview split that used to be two physically separate entry
// files (background/index.ts / background/index.preview.ts, picked by each
// manifest's own service_worker key) is now a single entrypoint gated by
// WXT's build mode: registerUpdateChecker() (and every string in it,
// including the GitHub Releases API host) is only reachable behind this
// `import.meta.env.MODE === "preview"` check. Vite/Rollup statically inlines
// import.meta.env.MODE and dead-code-eliminates the whole branch — including
// the dynamic import() expression itself — for any other mode, so the store
// build's bundle graph never reaches background/api/update-checker.ts.
// .github/workflows/ci.yml greps the built store output to verify this.
//
// Future home for: scheduling (browser.alarms) periodic scraping,
// centralizing EasySpeak + Basecamp storage, computing the delta once both
// sources are wired up.

import { registerMessageHandlers } from "../background/messaging";
import { registerSelfUpdateWatcher } from "../background/self-update";
import { PAGES, pageUrl } from "../shared/pages";
import { getLastViewedVersion, markVersionViewed } from "../shared/whats-new-badge";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    console.log("[Toastmasters VPE Assistant] Extension installed.");
    if (details.reason === "install") {
      browser.tabs.create({ url: pageUrl(PAGES.welcome) });
      // Fresh install is already on the latest version — nothing "new" to flag.
      await markVersionViewed(browser.runtime.getManifest().version);
    } else if (details.reason === "update") {
      // No auto-opened What's New tab (see the header comment). Seed the
      // "last seen" baseline from the version we upgraded FROM, but only if
      // there's no baseline yet — so the header badge's unread dot lights up
      // for users coming from a build that predates it, without overriding a
      // baseline a badge user has already set by opening the popover.
      const baseline = await getLastViewedVersion();
      if (baseline == null && details.previousVersion) {
        await markVersionViewed(details.previousVersion);
      }
    }
  });

  registerMessageHandlers();
  registerSelfUpdateWatcher();

  if (import.meta.env.MODE === "preview") {
    import("../background/api/update-checker").then((m) => m.registerUpdateChecker());
  }
});
