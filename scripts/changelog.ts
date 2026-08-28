// scripts/changelog.ts
//
// Pure, Node-only parsing/editing of CHANGELOG.md's Keep a Changelog format.
// No fs/child_process here — see generate-changelog-json.ts (build-time
// changelog.json generation) and cut-release.ts (the release script) for the
// I/O glue that calls into this file. Kept pure so it's plain Vitest-testable
// (tests/changelog-parser.test.ts, tests/changelog-release.test.ts) without a
// filesystem or a real CHANGELOG.md fixture on disk.

import type { ChangelogEntry, ChangelogSection } from "../src/shared/whats-new-types";

const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.+?)\s*$/;
const CONTINUATION = /^\s+(\S.*?)\s*$/;
// [ \t]*, not \s*, at the end — \s also matches \n, and being greedy it was
// swallowing the blank line that separates this heading from its body,
// silently collapsing it away on every promoteUnreleased() call.
const UNRELEASED_LINE = /^##\s+\[Unreleased\][ \t]*$/m;

/**
 * Parses every dated "## [X.Y.Z] - YYYY-MM-DD" section into a structured
 * entry (newest-first, matching Keep a Changelog's own top-to-bottom order).
 * The "## [Unreleased]" section is always skipped — its content hasn't
 * shipped to any released version yet, so it must never appear in
 * changelog.json.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  let current: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;

  const flushSection = () => {
    if (current && currentSection && currentSection.items.length > 0) {
      current.sections.push(currentSection);
    }
    currentSection = null;
  };

  const flushEntry = () => {
    flushSection();
    if (current && current.version.toLowerCase() !== "unreleased") {
      entries.push(current);
    }
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const versionMatch = line.match(VERSION_HEADING);
    if (versionMatch) {
      flushEntry();
      current = { version: versionMatch[1].trim(), date: (versionMatch[2] ?? "").trim(), sections: [] };
      continue;
    }

    if (!current) continue; // preamble before the first "## [...]" heading

    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      flushSection();
      currentSection = { heading: sectionMatch[1].trim(), items: [] };
      continue;
    }

    const bulletMatch = line.match(BULLET);
    if (bulletMatch && currentSection) {
      currentSection.items.push(bulletMatch[1].trim());
      continue;
    }

    // A hand-wrapped continuation of the previous bullet (indented, not
    // itself a new bullet/heading) — CHANGELOG.md entries wrap long lines
    // for readability, so this must be re-joined rather than dropped.
    const continuationMatch = line.match(CONTINUATION);
    if (continuationMatch && currentSection && currentSection.items.length > 0) {
      const lastIndex = currentSection.items.length - 1;
      currentSection.items[lastIndex] = `${currentSection.items[lastIndex]} ${continuationMatch[1]}`;
    }
  }
  flushEntry();

  return entries;
}

/**
 * Renames "## [Unreleased]" to "## [<version>] - <date>" and inserts a
 * fresh, empty "## [Unreleased]" above it — the promoted section's existing
 * body (and every entry below it) is left untouched. Used by
 * scripts/cut-release.ts as part of one atomic release-cutting invocation.
 */
export function promoteUnreleased(markdown: string, version: string, date: string): string {
  if (!UNRELEASED_LINE.test(markdown)) {
    throw new Error('promoteUnreleased: no "## [Unreleased]" heading found in CHANGELOG.md');
  }
  return markdown.replace(UNRELEASED_LINE, `## [Unreleased]\n\n## [${version}] - ${date}`);
}
