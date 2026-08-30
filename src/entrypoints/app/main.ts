// src/entrypoints/app/main.ts
//
// The merged single-page app shell: owns #appShell/#stepFooter/#viewRoot,
// a hash-based router (router.ts), and the VIEWS registry (views/index.ts).
// Centralizes what every one of the 6 former separate pages used to render
// independently (renderAppShell/renderStepFooter/markStepVisited) into one
// place, called once per navigation — each view module (shared/view.ts's
// ViewModule) now owns only its own body content, not the shared chrome.

import { renderAppShell, renderStepFooter, type AppShellPage, type StepperInfo } from "../../shared/app-shell";
import { escapeHtml } from "../../shared/dom-utils";
import { applyPendingSelfUpdate, getPendingSelfUpdate, maybeNudgeUpdateCheck } from "../../shared/self-update-store";
import { formatProfileLabel, getActiveProfile, getAnonymizeMode, setAnonymizeMode } from "../../shared/settings-store";
import { computeStepperInfo, markSetupComplete, markStepVisited } from "../../shared/stepper-info";
import { resolveRoute } from "./router";
import { VIEWS } from "./views";
import type { AppRoute } from "../../shared/pages";

const ROUTE_TITLE: Record<AppRoute, string> = {
  dashboard: "Home",
  setup: "Setup",
  syncData: "Sync Data",
  clubReview: "Club Review",
  members: "Member Review",
  report: "Club Progress",
  exporter: "Download Spreadsheet",
  globalSettings: "Global Settings",
};

// The four steps that render the wizard chrome (highlighted stepper item +
// Previous/Next footer + markStepVisited). dashboard/exporter/globalSettings
// /report are standalone routes outside the wizard flow (report — Club
// Progress — is reached from the Home dashboard's feature grid now).
const WIZARD_ROUTES: readonly AppShellPage[] = ["setup", "syncData", "clubReview", "members"];

const selfUpdateBannerRoot = document.getElementById("selfUpdateBannerRoot")!;
const appShellRoot = document.getElementById("appShell")!;
const stepFooterRoot = document.getElementById("stepFooter")!;
const viewRoot = document.getElementById("viewRoot")!;

// Delegated once, same rationale as appShellRoot's own delegated listener
// below — renderSelfUpdateBanner() replaces this root's innerHTML on every
// render, but the root element itself never changes.
selfUpdateBannerRoot.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("#selfUpdateApplyBtn")) void applyPendingSelfUpdate();
});

// Delegated once — renderChrome() replaces appShellRoot's innerHTML on every
// navigation, but the root element itself never changes, so a single
// listener covers every re-render (same pattern as popup/main.ts's own
// delegated stepper click listener). Mobile/tablet width's collapsible
// stepper accordion (see shared/app-shell.ts's .app-stepper__summary and
// shared/styles.css's ".app-stepper.expanded" rules) is a pure CSS class
// flip — no app state to track, so a fresh renderChrome() call (route
// change, or a storage-triggered chrome-only refresh) naturally resets it
// back to collapsed, which is the desired default each time.
appShellRoot.addEventListener("click", (e) => {
  const toggle = (e.target as HTMLElement).closest<HTMLElement>(".app-stepper__summary");
  if (!toggle) return;
  const nav = toggle.closest<HTMLElement>(".app-stepper");
  if (!nav) return;
  const expanded = nav.classList.toggle("expanded");
  toggle.setAttribute("aria-expanded", String(expanded));
});

// The header's Privacy Mode toggle (shared/app-shell.ts's #appPrivacyToggle) —
// delegated on the persistent #appShell root, same rationale as the stepper
// accordion listener above. setAnonymizeMode() writes storage.local, which
// the onChanged listener below turns into a navigate() → renderChrome() that
// re-renders the header with the fresh state, so the header and Global
// Settings' own toggle stay in sync.
appShellRoot.addEventListener("change", (e) => {
  const toggle = (e.target as HTMLElement).closest<HTMLInputElement>("#appPrivacyToggle");
  if (toggle) void setAnonymizeMode(toggle.checked);
});

// The wizard's final "Complete Setup" button (Member Review's step footer —
// shared/app-shell.ts's renderStepFooter()). Delegated on the persistent
// #stepFooter root, same rationale as the listeners above. Marks the wizard
// finished (→ Home banner flips to "Club Data Ready"), then navigates to the
// hub. preventDefault + explicit hash set so the flag write lands before the
// dashboard mounts, avoiding a "still in progress" flash.
stepFooterRoot.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#completeSetupBtn")) return;
  e.preventDefault();
  void (async () => {
    await markSetupComplete();
    location.hash = "dashboard";
  })();
});

let currentDispose: (() => void) | null = null;
let currentRoute: AppRoute | null = null;
// Bumped on every navigate() call — lets a call bail out early if a newer
// one already started while it was awaiting computeStepperInfo(), avoiding
// a wasted/out-of-order chrome (stepper) render.
let navToken = 0;
// Bumped only when actually about to mount a new view (synchronized with
// the currentRoute assignment below) — deliberately a SEPARATE counter from
// navToken: a same-route "chrome-only" navigate() call (e.g. a second
// storage write firing moments after the first, both while location.hash
// hasn't changed) must not be able to make a still-in-flight *real* mount
// look stale just because it happened to resolve later — only another
// *real* (route-changing) navigation may tear down an in-flight mount
// before it's committed. Using one shared counter for both purposes was a
// real bug: a chrome-only call bumped the same token a genuine mount's
// staleness check compared against, so the mount tore itself down (and its
// document-level listeners with it) the instant any unrelated storage
// write fired while it was still awaiting — reproduced via
// e2e/sync-data-export.spec.ts's "upgrades the automatic fallback pick"
// test, where setActiveProfile()'s two sequential storage.local writes
// (the profile itself, then clearProfile("demo")) raced exactly this way.
let mountToken = 0;

async function navigate(rawHash: string) {
  const myNavToken = ++navToken;
  const [info, profileId, anonymize] = await Promise.all([
    computeStepperInfo(),
    getActiveProfile(),
    getAnonymizeMode(),
  ]);
  if (myNavToken !== navToken) return; // a newer navigation started while we awaited

  const route = resolveRoute(rawHash, info);
  if (`#${route}` !== location.hash) {
    // Normalizes an empty/invalid/redirected hash. This itself fires
    // another hashchange, re-entering navigate() once more — self-
    // terminating, since resolveRoute() is idempotent on its own output.
    location.hash = route;
  }

  // No chip until a profile exists — "No profile selected yet" as a pill
  // reads oddly, and the stepper/banner already call out that setup is needed.
  await renderChrome(route, info, profileId ? formatProfileLabel(profileId) : undefined, anonymize);

  if (route === currentRoute) return; // chrome-only refresh (e.g. a storage change already re-ran this) — view stays mounted
  currentRoute = route;

  const myMountToken = ++mountToken;
  currentDispose?.();
  currentDispose = null;
  viewRoot.innerHTML = "";
  document.body.dataset.view = route;

  const dispose = await VIEWS[route].mount(viewRoot);
  if (myMountToken !== mountToken) {
    // A newer *real* (route-changing) navigation started — and already
    // mounted its own view — while this one was still mounting; tear down
    // what we just mounted instead of leaving two views' listeners alive.
    dispose();
    return;
  }
  currentDispose = dispose;
}

async function renderChrome(route: AppRoute, info: StepperInfo, profileLabel: string | undefined, anonymize: boolean) {
  const isWizardStep = (WIZARD_ROUTES as readonly string[]).includes(route);
  if (isWizardStep) await markStepVisited(route as AppShellPage);
  document.title = `Toastmasters VPE Assistant — ${ROUTE_TITLE[route]}`;
  appShellRoot.innerHTML = renderAppShell({
    active: isWizardStep ? (route as AppShellPage) : null,
    info,
    settingsActive: route === "globalSettings",
    // The Home dashboard, the Excel Exporter, Club Progress and Global
    // Settings are all outside the wizard flow — header-only, no stepper.
    showStepper: route !== "dashboard" && route !== "exporter" && route !== "report" && route !== "globalSettings",
    // The profile chip + Privacy toggle show on every route.
    profileLabel,
    anonymize,
    // "← Back to Home" on every sub-view; the Home hub itself is the one
    // route that doesn't get it.
    showBackToHome: route !== "dashboard",
  });
  stepFooterRoot.innerHTML = isWizardStep ? renderStepFooter(route as AppShellPage, info) : "";
  await renderSelfUpdateBanner();
}

// pendingSelfUpdate is only ever set by background/self-update.ts's
// onUpdateAvailable listener, which the browser fires rarely — only once it
// has already downloaded a genuinely newer version of this extension. No
// Dismiss button: there's nothing meaningful to dismiss into, the browser
// will apply the update on its own eventually regardless.
async function renderSelfUpdateBanner(): Promise<void> {
  const pending = await getPendingSelfUpdate();
  if (!pending) {
    selfUpdateBannerRoot.innerHTML = "";
    return;
  }
  selfUpdateBannerRoot.innerHTML = `
    <div class="update-banner">
      <span>Update ready: v${escapeHtml(pending.version)}</span>
      <span class="update-banner__actions">
        <button id="selfUpdateApplyBtn" class="btn btn-primary">Update now</button>
      </span>
    </div>
  `;
}

// Shell-chrome-only refresh: re-renders appShell/stepFooter on any storage
// change, independent of whatever the currently-mounted view does with its
// own storage.onChanged listener (registered inside that view's own
// mount()) — the two write to disjoint DOM subtrees and both re-derive
// fresh state from storage every time, so there's no shared cache for the
// two to race over regardless of firing order.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local" && currentRoute) navigate(location.hash);
  // pendingSelfUpdate lives in .session, not .local (see shared/storage.ts) —
  // a lighter-weight, banner-only refresh is enough here since a session
  // change is never a real navigation and doesn't need computeStepperInfo()/
  // route resolution re-run.
  if (area === "session" && currentRoute) void renderSelfUpdateBanner();
});

window.addEventListener("hashchange", () => navigate(location.hash));
navigate(location.hash);
void maybeNudgeUpdateCheck();
