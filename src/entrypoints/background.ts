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
// On "update", opens whats-new.html with ?from=<previousVersion> instead —
// stateless (no browser.storage tracking of what's already been "seen"): the
// browser's own onInstalled event data is enough to derive which changelog
// entries are new, see shared/whats-new-filter.ts's selectVisibleEntries().
// NOTE: Chrome fires onInstalled/"update" on essentially every extension
// reload during local unpacked/temporary-install dev, not just real version
// bumps (same quirk background/api/update-checker.ts lives with) — so this
// tab reopens on every dev-mode reload. Not a real-user-facing issue (a real
// update only fires this once), just a minor dev-loop annoyance.
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
import { PAGES, pageUrl, whatsNewUrl } from "../shared/pages";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    console.log("[Toastmasters VPE Assistant] Extension installed.");
    if (details.reason === "install") {
      browser.tabs.create({ url: pageUrl(PAGES.welcome) });
    } else if (details.reason === "update") {
      browser.tabs.create({ url: whatsNewUrl(details.previousVersion) });
    }
  });

  registerMessageHandlers();
  registerSelfUpdateWatcher();

  if (import.meta.env.MODE === "preview") {
    import("../background/api/update-checker").then((m) => m.registerUpdateChecker());
  }
});
