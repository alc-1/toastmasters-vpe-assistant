// src/shared/self-update-store.ts
//
// Storage I/O + actions for the browser's OWN auto-update mechanism —
// distinct from shared/update-store.ts, which is the preview build's
// GitHub-release polling domain for side-loaded installs no browser store
// ever auto-updates. This module's data comes from
// browser.runtime.onUpdateAvailable (background/self-update.ts is the only
// writer of `pendingSelfUpdate`) and applies to both build modes: a real
// store install genuinely receives onUpdateAvailable events, while a
// side-loaded preview install essentially never will since nothing
// auto-updates it — harmless dead weight there, see background/self-update.ts.
//
// No message-passing round trip anywhere here: runtime.reload(),
// runtime.requestUpdateCheck(), and storage.session/storage.local are all
// callable directly from any extension context, same established convention
// as update-store.ts's own openUpdateRelease() and app/views/members.ts's
// direct resolution-store.ts writes — no background-lifetime dependency to
// justify a message hop.

import { actionApi } from "./browser-action";
import { local, session } from "./storage";
import type { PendingSelfUpdate } from "./types";

const UPDATE_CHECK_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export async function getPendingSelfUpdate(): Promise<PendingSelfUpdate | undefined> {
  return session.value("pendingSelfUpdate");
}

/**
 * Called only from an explicit user click ("Update now" in the popup/app
 * banner) — never automatically, since reload() tears down every open
 * popup/tab's script context immediately, which would otherwise abort
 * whatever the user was doing (e.g. mid Sync Data session) without warning.
 *
 * Clears our own stale state FIRST and awaits it — reload() may tear down
 * this JS context immediately, and storage.session is not guaranteed to be
 * cleared by an extension reload (only by a real browser restart), so
 * without this the banner would keep claiming an update is "ready" even
 * after it's already been applied.
 */
export async function applyPendingSelfUpdate(): Promise<void> {
  await session.remove(["pendingSelfUpdate"]);
  await actionApi.setBadgeText({ text: "" });
  browser.runtime.reload();
}

/**
 * Opportunistically nudges the browser to check for an update sooner than
 * its own multi-hour internal schedule, throttled to at most once per hour
 * (tracked via `local.lastUpdateCheckRequestedAt`, not profile-scoped — see
 * shared/storage.ts). Safe to call from anywhere/anytime — fire-and-forget,
 * no return value depended on, which sidesteps any Chrome/Firefox difference
 * in requestUpdateCheck()'s resolved shape. Called from background's
 * onStartup (background/self-update.ts) and directly from the popup/app's
 * own init/mount.
 */
export async function maybeNudgeUpdateCheck(): Promise<void> {
  const lastRequestedAt = await local.value("lastUpdateCheckRequestedAt");
  if (lastRequestedAt && Date.now() - lastRequestedAt < UPDATE_CHECK_THROTTLE_MS) return;
  await local.set({ lastUpdateCheckRequestedAt: Date.now() });
  await browser.runtime.requestUpdateCheck();
}
