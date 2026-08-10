// src/shared/update-store.ts
//
// Storage I/O + the download/instructions flow for the preview build's
// update checker (background/api/update-checker.ts writes updateCheck;
// nothing else does). This is preview-build-only in practice — the store
// build never writes an updateCheck record — but the module itself has no
// build-mode branching, since it's harmless dead weight if ever called
// against an empty record.
//
// chrome.downloads/chrome.tabs/chrome.action are all callable from any
// extension context with the relevant permission, not background-only, so
// startUpdateDownload() is called directly from both the popup's Download
// button AND background's chrome.notifications.onClicked handler — no
// message-passing round trip needed (unlike EasySpeak's tab-navigation flow,
// which genuinely needs the service worker's lifetime across popup teardown).

import { local } from "./storage";
import { PAGES, pageUrl } from "./pages";
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
  await chrome.action.setBadgeText({ text: "" });
}

/**
 * Starts the release zip download, opens the reload/reinstall instructions
 * tab, and clears the toolbar badge. Only ever called from an explicit user
 * click (popup's Download button, or the OS notification itself) — never
 * automatically.
 */
export async function startUpdateDownload(info: UpdateCheckInfo): Promise<void> {
  await chrome.downloads.download({ url: info.downloadUrl });
  await chrome.tabs.create({
    url: `${pageUrl(PAGES.updateAvailable)}?v=${encodeURIComponent(info.latestVersion)}`,
  });
  await chrome.action.setBadgeText({ text: "" });
}
