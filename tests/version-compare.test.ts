import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/shared/version-compare";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("detects a newer major version", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
  });

  it("detects a newer minor version", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.1.9", "1.2.0")).toBe(-1);
  });

  it("detects a newer patch version", () => {
    expect(compareVersions("1.1.2", "1.1.1")).toBe(1);
    expect(compareVersions("1.1.1", "1.1.2")).toBe(-1);
  });

  it("treats a missing segment as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });
});
