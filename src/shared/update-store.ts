// src/shared/update-store.ts
//
// Storage I/O + the release-page flow for the preview build's update checker
// (background/api/update-checker.ts writes updateCheck; nothing else does).
// This is preview-build-only in practice — the store build never writes an
// updateCheck record — but the module itself has no build-mode branching,
// since it's harmless dead weight if ever called against an empty record.
//
// browser.tabs/browser.action are callable from any extension context with
// the relevant permission, not background-only, so openUpdateRelease() is
// called directly from both the popup's Download button AND background's
// browser.notifications.onClicked handler — no message-passing round trip
// needed (unlike EasySpeak's tab-navigation flow, which genuinely needs the
// background entrypoint's lifetime across popup teardown).
//
// This used to actually trigger the zip download itself via
// chrome.downloads.download(), but that download was silently getting
// cancelled: Chrome doesn't create the real DownloadItem until it gets a
// server response, and the very next step (opening a tab) steals window
// focus, which — when called from the popup — closes the popup and cancels
// any download that hadn't started yet. Simplest fix: don't drive the
// download from the extension at all, just send the user to the GitHub
// release page and let them click the asset themselves, same as the
// release notes' own instructions already tell them to do.

import { local } from "./storage";
import type { UpdateCheckInfo } from "./types";

export async function getUpdateCheck(): Promise<UpdateCheckInfo | undefined> {
  return local.value("updateCheck");
}

export async function getDismissedUpdateVersion(): Promise<string | undefined> {
  return local.value("updateDismissedVersion");
}

/**
 * Records that the user dismissed this version — background/api/update-checker.ts
 * checks this at detection time (not just render time) so the next 6-hour
 * recheck doesn't silently re-badge/re-notify for the same version. Doesn't
 * delete `updateCheck` itself: a strictly newer release later overwrites it
 * and naturally compares unequal to the dismissed version again.
 */
export async function dismissUpdate(version: string): Promise<void> {
  await local.set({ updateDismissedVersion: version });
  await browser.action.setBadgeText({ text: "" });
}

/**
 * Opens the GitHub release page in a new tab and clears the toolbar badge.
 * Only ever called from an explicit user click (popup's Download button, or
 * the OS notification itself) — never automatically.
 */
export async function openUpdateRelease(info: UpdateCheckInfo): Promise<void> {
  await browser.tabs.create({ url: info.releaseUrl });
  await browser.action.setBadgeText({ text: "" });
}
