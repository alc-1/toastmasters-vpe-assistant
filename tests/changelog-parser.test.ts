import { describe, expect, it } from "vitest";
import { parseChangelog } from "../scripts/changelog";

describe("parseChangelog", () => {
  it("parses multiple dated versions with multiple sections each, newest-first", () => {
    const markdown = `# Changelog

## [Unreleased]

### Added
- unreleased feature, must never appear in the output

## [1.1.0] - 2026-08-23

### Added
- Added thing one
- Added thing two

### Fixed
- Fixed thing one

## [1.0.0] - 2026-08-19

### Added
- Initial added thing
`;

    expect(parseChangelog(markdown)).toEqual([
      {
        version: "1.1.0",
        date: "2026-08-23",
        sections: [
          { heading: "Added", items: ["Added thing one", "Added thing two"] },
          { heading: "Fixed", items: ["Fixed thing one"] },
        ],
      },
      {
        version: "1.0.0",
        date: "2026-08-19",
        sections: [{ heading: "Added", items: ["Initial added thing"] }],
      },
    ]);
  });

  it("excludes the Unreleased section entirely, even with content", () => {
    const markdown = `## [Unreleased]

### Added
- something not yet released

## [0.1.0] - 2026-01-01

### Added
- first release
`;

    const entries = parseChangelog(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("0.1.0");
  });

  it("joins a hand-wrapped continuation line back onto the previous bullet", () => {
    const markdown = `## [Unreleased]

## [0.1.0] - 2026-01-01

### Added
- A long bullet that wraps across two lines for readability in the
  source file, but should read as one sentence once parsed.
- A second, unrelated bullet.
`;

    expect(parseChangelog(markdown)).toEqual([
      {
        version: "0.1.0",
        date: "2026-01-01",
        sections: [
          {
            heading: "Added",
            items: [
              "A long bullet that wraps across two lines for readability in the source file, but should read as one sentence once parsed.",
              "A second, unrelated bullet.",
            ],
          },
        ],
      },
    ]);
  });

  it("yields an empty sections array for a version with no subsections", () => {
    const markdown = `## [Unreleased]

## [0.1.0] - 2026-01-01
`;

    expect(parseChangelog(markdown)).toEqual([{ version: "0.1.0", date: "2026-01-01", sections: [] }]);
  });
});
