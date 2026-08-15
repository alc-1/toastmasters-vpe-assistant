// src/entrypoints/app/main.ts
//
// The merged single-page app shell: owns #appShell/#stepFooter/#viewRoot,
// a hash-based router (router.ts), and the VIEWS registry (views/index.ts).
// Centralizes what every one of the 6 former separate pages used to render
// independently (renderAppShell/renderStepFooter/markStepVisited) into one
// place, called once per navigation — each view module (shared/view.ts's
// ViewModule) now owns only its own body content, not the shared chrome.

import { renderAppShell, renderStepFooter, type AppShellPage, type StepperInfo } from "../../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../../shared/stepper-info";
import { resolveRoute } from "./router";
import { VIEWS } from "./views";
import type { AppRoute } from "../../shared/pages";

const ROUTE_TITLE: Record<AppRoute, string> = {
  setup: "Setup",
  syncData: "Sync Data",
  clubReview: "Club Review",
  members: "Member Review",
  report: "Club Progress",
  globalSettings: "Global Settings",
};

const appShellRoot = document.getElementById("appShell")!;
const stepFooterRoot = document.getElementById("stepFooter")!;
const viewRoot = document.getElementById("viewRoot")!;

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
  const info = await computeStepperInfo();
  if (myNavToken !== navToken) return; // a newer navigation started while we awaited

  const route = resolveRoute(rawHash, info);
  if (`#${route}` !== location.hash) {
    // Normalizes an empty/invalid/redirected hash. This itself fires
    // another hashchange, re-entering navigate() once more — self-
    // terminating, since resolveRoute() is idempotent on its own output.
    location.hash = route;
  }

  await renderChrome(route, info);

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

async function renderChrome(route: AppRoute, info: StepperInfo) {
  const isWizardStep = route !== "globalSettings";
  if (isWizardStep) await markStepVisited(route as AppShellPage);
  document.title = `Toastmasters VPE Assistant — ${ROUTE_TITLE[route]}`;
  appShellRoot.innerHTML = renderAppShell({
    active: isWizardStep ? (route as AppShellPage) : null,
    info,
    settingsActive: route === "globalSettings",
  });
  stepFooterRoot.innerHTML = isWizardStep ? renderStepFooter(route as AppShellPage, info) : "";
}

// Shell-chrome-only refresh: re-renders appShell/stepFooter on any storage
// change, independent of whatever the currently-mounted view does with its
// own storage.onChanged listener (registered inside that view's own
// mount()) — the two write to disjoint DOM subtrees and both re-derive
// fresh state from storage every time, so there's no shared cache for the
// two to race over regardless of firing order.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local" && currentRoute) navigate(location.hash);
});

window.addEventListener("hashchange", () => navigate(location.hash));
navigate(location.hash);
