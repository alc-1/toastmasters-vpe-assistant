import { describe, expect, it } from "vitest";
import { changelogHighlights, formatChangelogDate, hasUnreadChanges } from "../src/shared/whats-new-format";
import type { ChangelogEntry } from "../src/shared/whats-new-types";

describe("hasUnreadChanges", () => {
  it("is true when the running version is newer than the last seen one", () => {
    expect(hasUnreadChanges("1.2.0", "1.1.0")).toBe(true);
  });

  it("is false when the last seen version matches the running one", () => {
    expect(hasUnreadChanges("1.2.0", "1.2.0")).toBe(false);
  });

  it("is false when the last seen version is somehow newer", () => {
    expect(hasUnreadChanges("1.2.0", "1.3.0")).toBe(false);
  });

  it("compares numerically, not lexically (1.10.0 > 1.9.0)", () => {
    expect(hasUnreadChanges("1.10.0", "1.9.0")).toBe(true);
  });

  it("is false with no baseline (fresh install — null / undefined)", () => {
    expect(hasUnreadChanges("1.2.0", null)).toBe(false);
    expect(hasUnreadChanges("1.2.0", undefined)).toBe(false);
  });
});

describe("formatChangelogDate", () => {
  it("formats a YYYY-MM-DD date as \"MMM D\"", () => {
    expect(formatChangelogDate("2026-08-28")).toBe("Aug 28");
    expect(formatChangelogDate("2026-01-05")).toBe("Jan 5");
    expect(formatChangelogDate("2026-12-31")).toBe("Dec 31");
  });

  it("returns the input unchanged when it isn't a YYYY-MM-DD string", () => {
    expect(formatChangelogDate("")).toBe("");
    expect(formatChangelogDate("2026-08")).toBe("2026-08");
    expect(formatChangelogDate("last Tuesday")).toBe("last Tuesday");
  });

  it("returns the input unchanged for an out-of-range month", () => {
    expect(formatChangelogDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("changelogHighlights", () => {
  const entry: ChangelogEntry = {
    version: "1.2.0",
    date: "2026-08-28",
    sections: [
      { heading: "Added", items: ["A", "B"] },
      { heading: "Fixed", items: ["C", "D"] },
    ],
  };

  it("flattens section items in file order, capped at the limit", () => {
    expect(changelogHighlights(entry)).toEqual(["A", "B", "C"]);
  });

  it("respects an explicit limit", () => {
    expect(changelogHighlights(entry, 2)).toEqual(["A", "B"]);
    expect(changelogHighlights(entry, 10)).toEqual(["A", "B", "C", "D"]);
  });

  it("returns an empty array for an entry with no sections", () => {
    expect(changelogHighlights({ version: "1.0.0", date: "2026-01-01", sections: [] })).toEqual([]);
  });
});
