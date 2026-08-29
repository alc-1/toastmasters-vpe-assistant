import { describe, expect, it } from "vitest";
import { parseChangelog, promoteUnreleased } from "../scripts/changelog";

describe("promoteUnreleased", () => {
  it("renames Unreleased to a dated heading and inserts a fresh empty Unreleased above it", () => {
    const markdown = `# Changelog

## [Unreleased]

### Added
- something new

## [0.1.0] - 2026-01-01

### Added
- first release
`;

    const result = promoteUnreleased(markdown, "0.2.0", "2026-02-01");

    expect(result).toBe(`# Changelog

## [Unreleased]

## [0.2.0] - 2026-02-01

### Added
- something new

## [0.1.0] - 2026-01-01

### Added
- first release
`);
  });

  it("leaves every entry below the promoted one untouched", () => {
    const markdown = `## [Unreleased]

## [0.1.0] - 2026-01-01

### Fixed
- an old fix
`;

    const result = promoteUnreleased(markdown, "0.2.0", "2026-02-01");

    expect(result).toContain(`## [0.1.0] - 2026-01-01

### Fixed
- an old fix`);
  });

  it("throws when no Unreleased heading exists", () => {
    const markdown = `## [0.1.0] - 2026-01-01
`;

    expect(() => promoteUnreleased(markdown, "0.2.0", "2026-02-01")).toThrow(/Unreleased/);
  });
});

// Guards the release pipeline as a whole: cut-release.ts promotes [Unreleased] to
// a dated heading, then generate-changelog-json.ts must be able to parse that same
// version into changelog.json (the What's New source). A build that regenerates
// changelog.json *before* the promotion — as .github/workflows/release.yml used to
// — ships a changelog.json missing the just-released version.
describe("promoteUnreleased -> parseChangelog", () => {
  it("makes a freshly cut version immediately parseable, with all its sections", () => {
    const markdown = `# Changelog

## [Unreleased]

### Added

- A brand-new feature.

### Fixed

- A bug squashed.

## [1.1.0] - 2026-08-23

### Added

- An older thing.
`;

    const promoted = promoteUnreleased(markdown, "1.2.0", "2026-08-28");
    const entries = parseChangelog(promoted);

    expect(entries[0]).toEqual({
      version: "1.2.0",
      date: "2026-08-28",
      sections: [
        { heading: "Added", items: ["A brand-new feature."] },
        { heading: "Fixed", items: ["A bug squashed."] },
      ],
    });
    expect(entries.map((e) => e.version)).toEqual(["1.2.0", "1.1.0"]);
  });
});
