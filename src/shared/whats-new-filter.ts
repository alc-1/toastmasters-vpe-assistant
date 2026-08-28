// src/shared/whats-new-filter.ts
//
// Pure selection logic for entrypoints/whats-new/main.ts: given the bundled
// changelog and the current/"since" version, decides which entries to show
// so a user who skipped several releases sees everything they missed.

import { compareVersions } from "./version-compare";
import type { ChangelogEntry } from "./whats-new-types";

/**
 * Returns entries up to/including `current`, newest-first. If `from` is a
 * version present in `changelog`, only entries strictly newer than it are
 * included ("what's changed since `from`"). If `from` is missing or not
 * present in `changelog` (including a page visited with no ?from= query
 * param at all), every entry up to `current` is returned instead — "from
 * the beginning" is the default, not "just the latest entry".
 */
export function selectVisibleEntries(
  changelog: ChangelogEntry[],
  current: string,
  from: string | null,
): ChangelogEntry[] {
  const lowerBound = from != null && changelog.some((e) => e.version === from) ? from : null;

  return changelog
    .filter((e) => (lowerBound === null || compareVersions(e.version, lowerBound) > 0) && compareVersions(e.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}
