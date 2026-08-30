// src/shared/whats-new-badge.ts
//
// State + data for the header version badge and its release-notes popover
// (shared/app-shell.ts's renderVersionBadge() draws them; entrypoints/app/
// main.ts wires the click/dismiss handlers). This is "Strategy 3" of the
// update-notification options: a quiet top-bar badge with an unread dot,
// replacing the previous behaviour where installing an update auto-opened a
// full What's New tab (entrypoints/background.ts no longer does that — it just
// seeds the "last seen" baseline below instead).
//
// The changelog itself is the same build-time-bundled /changelog.json that
// entrypoints/app/views/whatsNew.ts renders (see scripts/generate-changelog-json.ts)
// — fetched once per page and memoized here. Pure formatting/predicate helpers
// live in shared/whats-new-format.ts; this file owns the browser.*/storage side.

import { local } from "./storage";
import { compareVersions } from "./version-compare";
import { hasUnreadChanges, type VersionBadgeState } from "./whats-new-format";
import type { ChangelogEntry } from "./whats-new-types";

export type { VersionBadgeState } from "./whats-new-format";

let changelogPromise: Promise<ChangelogEntry[]> | null = null;

function loadChangelog(): Promise<ChangelogEntry[]> {
  if (!changelogPromise) {
    changelogPromise = fetch(browser.runtime.getURL("/changelog.json"))
      .then((res) => res.json() as Promise<ChangelogEntry[]>)
      .catch(() => [] as ChangelogEntry[]);
  }
  return changelogPromise;
}

/** The extension version whose changelog the user has most recently seen via
 *  the badge popover. undefined until the popover is first opened or the
 *  baseline is seeded by entrypoints/background.ts's onInstalled. */
export async function getLastViewedVersion(): Promise<string | undefined> {
  return local.value("lastViewedVersion");
}

/**
 * Records `version` as seen, clearing the unread dot. No-op when already at
 * that version, so the storage.onChanged listeners this would wake stay quiet
 * on a redundant call (every popover open would otherwise re-fire them).
 */
export async function markVersionViewed(version: string): Promise<void> {
  if ((await getLastViewedVersion()) === version) return;
  await local.set({ lastViewedVersion: version });
}

export async function loadVersionBadgeState(): Promise<VersionBadgeState> {
  const version = browser.runtime.getManifest().version;
  const [changelog, lastViewed] = await Promise.all([loadChangelog(), getLastViewedVersion()]);

  // changelog is newest-first (see scripts/changelog.ts). Normally
  // changelog[0].version === the running version (a release cut bumps
  // package.json and dates the top section together), but guard against a
  // dev build whose package.json was bumped ahead of CHANGELOG.md.
  const latest = changelog.find((entry) => compareVersions(entry.version, version) <= 0) ?? changelog[0] ?? null;

  return { version, hasUnread: hasUnreadChanges(version, lastViewed), latest };
}
