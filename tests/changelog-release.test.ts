import { describe, expect, it } from "vitest";
import { promoteUnreleased } from "../scripts/changelog";

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
