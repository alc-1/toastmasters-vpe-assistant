import { describe, expect, it } from "vitest";
import { selectVisibleEntries } from "../src/shared/whats-new-filter";
import type { ChangelogEntry } from "../src/shared/whats-new-types";

const CHANGELOG: ChangelogEntry[] = [
  { version: "1.2.0", date: "2026-03-01", sections: [] },
  { version: "1.1.0", date: "2026-02-01", sections: [] },
  { version: "1.0.0", date: "2026-01-01", sections: [] },
];

describe("selectVisibleEntries", () => {
  it("returns everything strictly after `from` up to and including `current`, newest-first", () => {
    const result = selectVisibleEntries(CHANGELOG, "1.2.0", "1.0.0");
    expect(result.map((e) => e.version)).toEqual(["1.2.0", "1.1.0"]);
  });

  it("returns every entry up to `current` when `from` is missing (defaults to \"from the beginning\")", () => {
    const result = selectVisibleEntries(CHANGELOG, "1.1.0", null);
    expect(result.map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("returns every entry up to `current` when `from` isn't found in the changelog", () => {
    const result = selectVisibleEntries(CHANGELOG, "1.1.0", "0.9.0");
    expect(result.map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("returns an empty array (not a throw) when nothing in the changelog is old enough to qualify", () => {
    const result = selectVisibleEntries(CHANGELOG, "0.5.0", null);
    expect(result).toEqual([]);
  });
});
