// src/shared/whats-new-format.ts
//
// Pure formatting/predicate helpers for the app footer's version string +
// "What's New" link (shared/app-shell.ts's renderAppFooter). No browser.* or
// storage dependency — the stateful side (reading the running version, the
// "last seen" storage key, fetching changelog.json) lives in
// shared/whats-new-badge.ts, which builds on these.

import { compareVersions } from "./version-compare";
import type { ChangelogEntry } from "./whats-new-types";

/** The view-model renderAppFooter() consumes — built by
 *  shared/whats-new-badge.ts's loadVersionBadgeState(). */
export interface VersionBadgeState {
  /** The running extension version, e.g. "1.2.0" (no leading "v"). */
  version: string;
  /** True when there's at least one changelog entry newer than what the user
   *  has already seen (opened the #whatsNew view for) — drives the unread dot
   *  on the footer link. */
  hasUnread: boolean;
  /** Newest changelog entry at or below the running version. Retained on the
   *  view-model (built by loadVersionBadgeState) even though renderAppFooter
   *  no longer shows a summary inline; null only when changelog.json is empty
   *  or failed to load. */
  latest: ChangelogEntry | null;
}

/**
 * Whether the running build has notes the user hasn't acknowledged yet.
 * `lastViewed` is null/undefined on a fresh install (nothing stored) — that
 * deliberately reads as "no unread", so a new user isn't greeted by an alert
 * dot (entrypoints/background.ts seeds the baseline on install/update).
 */
export function hasUnreadChanges(current: string, lastViewed: string | null | undefined): boolean {
  return lastViewed != null && compareVersions(current, lastViewed) > 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-28" -> "Aug 28" — the compact form the popover header uses next to
 * the version (matching "Version 1.2.0 • Aug 28"). Returns the input
 * unchanged if it isn't the expected YYYY-MM-DD shape.
 */
export function formatChangelogDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return date;
  return `${month} ${Number(match[3])}`;
}

/**
 * Up to `limit` bullet lines from a changelog entry, flattened across its
 * Added/Changed/Fixed sections in file order — the 2-3 concise points the
 * popover shows before linking out to the full history.
 */
export function changelogHighlights(entry: ChangelogEntry, limit = 3): string[] {
  return entry.sections.flatMap((section) => section.items).slice(0, limit);
}
