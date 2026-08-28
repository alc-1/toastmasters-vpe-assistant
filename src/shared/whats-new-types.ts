// src/shared/whats-new-types.ts
//
// The shape of changelog.json (see scripts/generate-changelog-json.ts),
// parsed at build time from CHANGELOG.md by scripts/changelog.ts and
// consumed at runtime by entrypoints/whats-new/main.ts. Imported as
// types-only by the Node-side parser, so this file has no browser.*
// dependency and is safe to import from either side.

export interface ChangelogSection {
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string; // "YYYY-MM-DD", from the "## [X.Y.Z] - YYYY-MM-DD" heading
  sections: ChangelogSection[];
}
