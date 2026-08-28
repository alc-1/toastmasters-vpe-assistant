// src/shared/version-compare.ts
//
// Plain numeric segment-by-segment comparator — versions here are always
// npm-version-bumped x.y.z, no semver range/pre-release syntax to support.
// Same approach background/api/update-checker.ts's own local isNewerVersion()
// already uses; promoted here since shared/whats-new-filter.ts (and its
// tests) need the same comparison — update-checker.ts's existing, working
// copy is left as-is rather than migrated.

export function compareVersions(a: string, b: string): number {
  const segsA = a.split(".").map(Number);
  const segsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(segsA.length, segsB.length); i++) {
    const diff = (segsA[i] ?? 0) - (segsB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
