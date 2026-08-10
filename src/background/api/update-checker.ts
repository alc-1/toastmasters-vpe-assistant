// src/background/api/update-checker.ts
//
// Preview-build-only: polls GitHub's Releases API for a newer tagged release
// than the running extension's own version, and if found, badges the
// toolbar icon and fires one OS notification. This file (and every string in
// it, including the GitHub API host) is never bundled into the store build —
// only background/index.preview.ts imports it, and manifest.store.json's
// service worker entry (background/index.ts) never does. See
// background/index.preview.ts for why a physically separate entry file is
// used instead of a runtime flag.
//
// registerUpdateChecker() registers every chrome.alarms/chrome.notifications
// listener synchronously, at call time — not from inside a .then() after a
// dynamic import — because MV3 service workers only reliably redeliver an
// event to a listener that was registered during the worker's initial
// synchronous top-level evaluation.

import { local } from "../../shared/storage";
import { openUpdateRelease } from "../../shared/update-store";
import type { UpdateCheckInfo } from "../../shared/types";

const REPO = "alc-1/toastmasters-vpe-assistant";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_ALARM_NAME = "checkForPreviewUpdate";
const CHECK_INTERVAL_MINUTES = 360; // 6 hours
const UPDATE_NOTIFICATION_ID = "toastmasters-vpe-assistant-update-available";

interface GitHubRelease {
  tag_name: string;
  html_url: string;
}

export function registerUpdateChecker(): void {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM_NAME) void checkForUpdate();
  });

  // A second, independent onInstalled listener from background/index.ts's own
  // (welcome-page-only) one — Chrome runs every registered listener for an
  // event, so this doesn't interfere with it. Gives a freshly installed or
  // updated preview build its first check immediately rather than waiting up
  // to 6 hours for the first alarm.
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install" || details.reason === "update") void checkForUpdate();
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== UPDATE_NOTIFICATION_ID) return;
    chrome.notifications.clear(UPDATE_NOTIFICATION_ID);
    void handleNotificationClick();
  });
}

async function handleNotificationClick(): Promise<void> {
  const info = await local.value("updateCheck");
  if (info) await openUpdateRelease(info);
}

async function checkForUpdate(): Promise<void> {
  let release: GitHubRelease;
  try {
    const res = await fetch(LATEST_RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return; // best-effort — retried on the next alarm
    release = await res.json();
  } catch {
    return;
  }

  const latestVersion = release.tag_name.replace(/^v/, "");
  const currentVersion = chrome.runtime.getManifest().version;

  if (!isNewerVersion(latestVersion, currentVersion)) {
    await local.remove(["updateCheck"]);
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  const dismissedVersion = await local.value("updateDismissedVersion");
  if (latestVersion === dismissedVersion) return; // user already dismissed this exact version

  const previous = await local.value("updateCheck");
  const isFirstSightingOfThisVersion = previous?.latestVersion !== latestVersion;

  const info: UpdateCheckInfo = { latestVersion, releaseUrl: release.html_url, checkedAt: Date.now() };
  await local.set({ updateCheck: info });

  await chrome.action.setBadgeText({ text: "1" });
  await chrome.action.setBadgeBackgroundColor({ color: "#004165" }); // --tm-navy — informational, not the red "error" icon state

  if (isFirstSightingOfThisVersion) {
    chrome.notifications.create(UPDATE_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: "icons/default/128.png",
      title: "Update available",
      message: `Toastmasters VPE Assistant v${latestVersion} is ready — click to view the release.`,
    });
  }
}

/** Plain numeric segment-by-segment comparison — versions here are always npm-version-bumped x.y.z, no semver range/pre-release syntax to support. */
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const diff = (l[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
