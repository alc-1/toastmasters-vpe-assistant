// src/background/self-update.ts
//
// Watches for the browser's OWN pending self-update — distinct from
// background/api/update-checker.ts's preview-only GitHub-release poll (see
// shared/self-update-store.ts's header comment for the full domain split).
// Registered unconditionally from entrypoints/background.ts in BOTH build
// modes: a side-loaded/temporary preview install will essentially never fire
// runtime.onUpdateAvailable (nothing auto-updates it), so this is harmless
// dead weight there rather than something that needs gating behind
// import.meta.env.MODE, unlike update-checker.ts.
//
// registerSelfUpdateWatcher() registers both listeners synchronously, at
// call time — same MV3 service-worker redelivery requirement
// update-checker.ts's own comment documents for its own listeners.

import { actionApi } from "../shared/browser-action";
import { session } from "../shared/storage";
import { maybeNudgeUpdateCheck } from "../shared/self-update-store";
import type { PendingSelfUpdate } from "../shared/types";

const SELF_UPDATE_BADGE_COLOR = "#004165"; // --tm-navy — same informational color update-checker.ts uses

export function registerSelfUpdateWatcher(): void {
  browser.runtime.onUpdateAvailable.addListener((details) => {
    void handleUpdateAvailable(details.version);
  });

  browser.runtime.onStartup.addListener(() => {
    void maybeNudgeUpdateCheck();
  });

  // The badge is a pure function of pendingSelfUpdate, kept in sync via this
  // listener rather than being applied only as a one-off side effect of
  // handleUpdateAvailable() below — that way it stays correct regardless of
  // *what* wrote the key (the real event, a fresh service-worker wake seeing
  // pre-existing state, or a manual value set from a console for testing —
  // see CLAUDE.md's "Testing the self-update" section).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && "pendingSelfUpdate" in changes) void syncBadge();
  });

  // Reconcile immediately too, in case this is a fresh service-worker wake
  // with state already sitting in storage from before it last went idle.
  void syncBadge();
}

async function syncBadge(): Promise<void> {
  const pending = await session.value("pendingSelfUpdate");

  if (!pending) {
    await actionApi.setBadgeText({ text: "" });
    return;
  }

  // Self-heal: if pendingSelfUpdate names the version we're now ALREADY
  // running (the browser applied the update on its own, independent of our
  // button — or storage.session happened to survive across the reload that
  // applied it), clear the stale flag/badge instead of leaving a
  // permanently-wrong "update ready" banner. The resulting removal re-enters
  // this function via the onChanged listener above and simply clears the
  // badge on that second pass — harmless, not infinite.
  if (pending.version === browser.runtime.getManifest().version) {
    await session.remove(["pendingSelfUpdate"]);
    return;
  }

  await actionApi.setBadgeText({ text: "1" });
  await actionApi.setBadgeBackgroundColor({ color: SELF_UPDATE_BADGE_COLOR });
}

async function handleUpdateAvailable(version: string): Promise<void> {
  const pending: PendingSelfUpdate = { version, detectedAt: Date.now() };
  // Just writes the state — the onChanged listener above applies the badge
  // as a reaction to this write, same as any other writer of this key.
  await session.set({ pendingSelfUpdate: pending });
}
