import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clubNameScore,
  levenshtein,
  matchClubs,
  matchMembers,
  nameScore,
  normalizeClubName,
  normalizeName,
  canonicalizePathName,
  diffLevel,
  matchPaths,
} from "../src/shared/sync/conflicts";
import {
  buildLevelSummary,
  buildReport,
  classifyMember,
  compareLevelSummaryRows,
  computeLevelSummary,
  computeMatchSummary,
  hasFlaggedPaths,
  hasOrphanedPaths,
  hasPathOrphan,
  hasPathOverride,
  isMemberResolved,
  needsAction,
} from "../src/shared/sync/delta";
import type { BasecampScrape, ClubPairReport, EasySpeakScrape, LevelDiff, LevelSummaryRow, MemberReport, PathReport } from "../src/shared/types";

const DATA_DIR = fileURLToPath(new URL("../test-data/report/", import.meta.url));
const basecampData: BasecampScrape = JSON.parse(readFileSync(DATA_DIR + "basecampData.sample.json", "utf8"));
const easyspeakData: EasySpeakScrape = JSON.parse(readFileSync(DATA_DIR + "easyspeakData.sample.json", "utf8"));

function findClubPair(
  report: ReturnType<typeof buildReport>,
  { basecampClubName, easyspeakClubName }: { basecampClubName?: string | null; easyspeakClubName?: string | null }
): ClubPairReport {
  return report.clubPairs.find(
    (c) => c.basecampClubName === (basecampClubName ?? null) && c.easyspeakClubName === (easyspeakClubName ?? null)
  )!;
}

function findMember(club: ClubPairReport, { basecampName, easyspeakName }: { basecampName?: string | null; easyspeakName?: string | null }): MemberReport {
  return club.members.find((m) => m.basecampName === (basecampName ?? null) && m.easyspeakName === (easyspeakName ?? null))!;
}

// ---------------------------------------------------------------------------
// Pure-function edge cases (inline literals)
// ---------------------------------------------------------------------------

describe("normalizeName", () => {
  it("strips trailing level-progress honorific codes", () => {
    expect(normalizeName("Nigel Thew PM5 PI5")).toBe(normalizeName("Nigel Thew"));
  });

  it("drops everything after a comma", () => {
    expect(normalizeName("Godela Bittcher, CC CL DL5")).toBe(normalizeName("Godela Bittcher"));
  });

  it("ignores word order", () => {
    expect(normalizeName("Robert O'Riordan")).toBe(normalizeName("O'Riordan Robert"));
  });
});

describe("levenshtein", () => {
  it("computes classic edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("nameScore", () => {
  it("scores an identical normalized name as exact", () => {
    expect(nameScore("Grace Thompson", "Grace Thompson")).toEqual({ score: 1, confidence: "exact" });
  });

  it("scores a near-duplicate spelling above the fuzzy threshold", () => {
    const { score, confidence } = nameScore("Owen Bright", "Owen Brights");
    expect(confidence).toBe("fuzzy");
    expect(score).toBeGreaterThanOrEqual(0.72);
    expect(score).toBeLessThan(1);
  });

  it("scores two unrelated names below the fuzzy threshold", () => {
    const { confidence } = nameScore("Priya Chandrasekaran", "Someone Completely Different");
    expect(confidence).toBeNull();
  });
});

describe("clubNameScore / normalizeClubName", () => {
  it("strips 'toastmasters'/'club' words before comparing", () => {
    expect(normalizeClubName("Riverside Toastmasters")).toBe("riverside");
    expect(clubNameScore("Riverside Toastmasters", "Riverside Toastmasters")).toBe(1);
  });

  it("scores unrelated club names below 1", () => {
    expect(clubNameScore("Riverside Toastmasters", "Hilltop Communicators")).toBeLessThan(1);
  });
});

describe("canonicalizePathName", () => {
  it("resolves a French alias to its canonical English key", () => {
    expect(canonicalizePathName("Coaching efficace")).toEqual({ key: "effective coaching", nonPathway: false });
  });

  it("strips an EasySpeak version suffix before canonicalizing", () => {
    expect(canonicalizePathName("Presentation Mastery (2021-10)")).toEqual({
      key: "presentation mastery",
      nonPathway: false,
    });
  });

  it("flags a non-Pathways activity name", () => {
    expect(canonicalizePathName("Speechcraft")).toEqual({ key: "speechcraft", nonPathway: true });
  });
});

describe("diffLevel", () => {
  it("flags pendingValidation when both sides consider the level done but Basecamp hasn't approved it", () => {
    const diff = diffLevel(1, { level: 1, needed: 2, done: 2 }, { completed: 2, total: 2, approved: false });
    expect(diff.pendingValidation).toBe(true);
    expect(diff.discrepancy).toBe(0);
  });

  it("does not flag pendingValidation once Basecamp has approved it", () => {
    const diff = diffLevel(1, { level: 1, needed: 2, done: 2 }, { completed: 2, total: 2, approved: true });
    expect(diff.pendingValidation).toBe(false);
  });
});

describe("matchPaths", () => {
  it("cumulates Basecamp's Level 5 and Path Completion entries when comparing against EasySpeak's Level 5", () => {
    const basecampPerson = {
      userId: 1,
      name: "Test Member",
      paths: [
        {
          path_name: "Dynamic Leadership",
          progression: {
            "Level 5": { completed: 1, total: 2, approved: false },
            "Path Completion": { completed: 1, total: 1 },
          },
        },
      ],
    };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [{ path: "Dynamic Leadership", levels: [{ level: 5, needed: 3, done: 2 }] }],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson);
    const level5 = paths[0].levels[4];

    // Cumulated for the comparison: 1 (Level 5) + 1 (Path Completion) = 2/3.
    expect(level5.basecamp).toEqual({ completed: 2, total: 3, approved: false });
    expect(level5.easyspeak).toEqual({ needed: 3, done: 2 });
    expect(level5.discrepancy).toBe(0);
    expect(level5.basecampMissing).toBe(1);

    // The raw, un-cumulated Path Completion entry is still reported
    // separately for its own Basecamp-only display.
    expect(paths[0].pathCompletion).toEqual({ completed: 1, total: 1, missing: 0 });
  });

  it("tags a completed easyspeak-only path (all levels needed 0) as completedHistory, not an actionable orphan", () => {
    // Basecamp's live progress extraction only returns a member's currently-
    // active path(s) — a path already completed drops out of Basecamp
    // entirely, while EasySpeak keeps the full history. This member has one
    // currently-active Basecamp path with no EasySpeak entry yet, plus one
    // EasySpeak-only path they already finished (nothing left needed).
    const basecampPerson = {
      userId: 1,
      name: "Test Member",
      paths: [
        {
          path_name: "Persuasive Influence",
          progression: {
            "Level 1": { completed: 1, total: 2, approved: true },
          },
        },
      ],
    };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [
        {
          path: "Innovative Planning (2017)",
          levels: [
            { level: 1, needed: 0, done: 0 },
            { level: 2, needed: 0, done: 0 },
            { level: 3, needed: 0, done: 0 },
            { level: 4, needed: 0, done: 0 },
            { level: 5, needed: 0, done: 0 },
          ],
        },
      ],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson);
    const activePath = paths.find((p) => p.presence === "basecamp-only")!;
    const completedPath = paths.find((p) => p.presence === "easyspeak-only")!;

    expect(completedPath.completedHistory).toBe(true);
    expect(activePath.completedHistory).toBe(false);
    expect(hasOrphanedPaths({ presence: "both", paths })).toBe(false);
  });

  it("tags a completed easyspeak-only path with real, fully-satisfied counts (not needed=0) as completedHistory", () => {
    // Some completed EasySpeak paths report real non-zero needed/done counts
    // rather than needed=0 everywhere — still completed (done >= needed on
    // every level), still absent from Basecamp's active-only extraction.
    const basecampPerson = {
      userId: 1,
      name: "Test Member",
      paths: [
        {
          path_name: "Persuasive Influence",
          progression: {
            "Level 1": { completed: 1, total: 2, approved: true },
          },
        },
      ],
    };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [
        {
          path: "Innovative Planning (2017)",
          levels: [
            { level: 1, needed: 2, done: 2 },
            { level: 2, needed: 4, done: 4 },
            { level: 3, needed: 4, done: 4 },
            { level: 4, needed: 4, done: 4 },
            { level: 5, needed: 2, done: 2 },
          ],
        },
      ],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson);
    const completedPath = paths.find((p) => p.presence === "easyspeak-only")!;

    expect(completedPath.completedHistory).toBe(true);
    expect(hasOrphanedPaths({ presence: "both", paths })).toBe(false);
  });

  it("does not tag an easyspeak-only path with real remaining work as completedHistory", () => {
    // A genuine mismatch — the member picked a different, still-active path
    // than Basecamp has on record — must keep flagging as an actionable
    // orphan; this fix must never suppress it.
    const basecampPerson = {
      userId: 1,
      name: "Test Member",
      paths: [
        {
          path_name: "Innovative Planning",
          progression: {
            "Level 1": { completed: 2, total: 2, approved: true },
          },
        },
      ],
    };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [
        {
          path: "Strategic Relationships",
          levels: [
            { level: 1, needed: 2, done: 2 },
            { level: 2, needed: 3, done: 0 },
          ],
        },
      ],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson);
    const easyspeakOnly = paths.find((p) => p.presence === "easyspeak-only")!;

    expect(easyspeakOnly.completedHistory).toBe(false);
    expect(hasOrphanedPaths({ presence: "both", paths })).toBe(true);
  });

  it("flags an unresolved easyspeak-only path even when there's no basecamp-only candidate at all", () => {
    // A member with no Basecamp record for this path whatsoever (not just a
    // mismatched one) must still surface as an actionable path issue — this
    // is the one-sided case renderPathBindDetail() already offers Bind/Mark
    // as orphan/Flag/Mark as completed actions for, so it must count toward
    // "To do" too, not only be reachable via "All".
    const basecampPerson = { userId: 1, name: "Test Member", paths: [] };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [
        {
          path: "Strategic Relationships",
          levels: [
            { level: 1, needed: 2, done: 1 },
            { level: 2, needed: 3, done: 0 },
          ],
        },
      ],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson);
    expect(paths.every((p) => p.presence === "easyspeak-only")).toBe(true);
    expect(hasOrphanedPaths({ presence: "both", paths })).toBe(true);
  });

  it("tags the flagged side's PathReport with flagged: true and leaves every other path false", () => {
    const basecampPerson = {
      userId: 1,
      name: "Test Member",
      paths: [{ path_name: "Strategic Relationships", progression: { "Level 1": { completed: 1, total: 1, approved: true } } }],
    };
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [{ path: "Team Collaboration", levels: [{ level: 1, needed: 1, done: 1 }] }],
    };

    const { paths } = matchPaths(basecampPerson, easyspeakPerson, [], undefined, [], [], [
      { basecampUserId: 1, easyspeakMemberId: "e1", basecampPathName: "Strategic Relationships", easyspeakPathLabel: null, flaggedAt: 0 },
    ]);

    const bcOnly = paths.find((p) => p.presence === "basecamp-only")!;
    const esOnly = paths.find((p) => p.presence === "easyspeak-only")!;
    expect(bcOnly.flagged).toBe(true);
    expect(esOnly.flagged).toBe(false);
  });

  it("tags an easyspeak-only path manuallyCompleted from a memberPathCompletions entry", () => {
    const easyspeakPerson = {
      memberId: "e1",
      name: "Test Member",
      paths: [{ path: "Team Collaboration", levels: [{ level: 1, needed: 3, done: 1 }] }],
    };

    const { paths } = matchPaths(null, easyspeakPerson, [], undefined, [], [], [], [
      { basecampUserId: 1, easyspeakMemberId: "e1", easyspeakPathLabel: "Team Collaboration", completedAt: 0 },
    ]);

    const esOnly = paths.find((p) => p.presence === "easyspeak-only")!;
    expect(esOnly.manuallyCompleted).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// matchClubs / matchMembers with persisted-resolution overrides
// ---------------------------------------------------------------------------

describe("matchClubs", () => {
  it("only auto-matches on an exact normalized-name score of 1", () => {
    const pairs = matchClubs(
      [{ id: "b1", name: "Riverside Toastmasters", people: [] }],
      [{ id: "e1", name: "Riverside Toastmasters", people: [] }]
    );
    expect(pairs).toEqual([{ basecamp: expect.any(Object), easyspeak: expect.any(Object), score: 1, confidence: "exact", source: null }]);
  });

  it("forces a pin from clubLookup even without a name match", () => {
    const pairs = matchClubs(
      [{ id: "b1", name: "Basecamp Name", people: [] }],
      [{ id: "e1", name: "Totally Different Name", people: [] }],
      [{ basecampClubId: "b1", easyspeakClubId: "e1", basecampClubName: "Basecamp Name", easyspeakClubName: "Totally Different Name" }]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ score: null, confidence: "confirmed" });
  });

  it("only surfaces a fuzzy (partial-score) suggestion when allowFuzzy is true", () => {
    const bc = [{ id: "b1", name: "Riverside Downtown Toastmasters", people: [] }];
    const es = [{ id: "e1", name: "Riverside Downtown Professionals Club", people: [] }];

    const withoutFuzzy = matchClubs(bc, es);
    expect(withoutFuzzy).toEqual([
      { basecamp: bc[0], easyspeak: null, score: null, confidence: null, source: null },
      { basecamp: null, easyspeak: es[0], score: null, confidence: null, source: null },
    ]);

    const withFuzzy = matchClubs(bc, es, [], [], true);
    const pair = withFuzzy.find((p) => p.basecamp && p.easyspeak)!;
    expect(pair.confidence).toBe("fuzzy");
    expect(pair.score).toBeGreaterThanOrEqual(0.5);
    expect(pair.score).toBeLessThan(1);
  });

  it("excludes a rejected club pair from candidate generation even with allowFuzzy", () => {
    const bc = [{ id: "b1", name: "Riverside Downtown Toastmasters", people: [] }];
    const es = [{ id: "e1", name: "Riverside Downtown Professionals Club", people: [] }];

    const pairs = matchClubs(bc, es, [], [{ basecampClubId: "b1", easyspeakClubId: "e1", rejectedAt: 0 }], true);
    expect(pairs).toEqual([
      { basecamp: bc[0], easyspeak: null, score: null, confidence: null, source: null },
      { basecamp: null, easyspeak: es[0], score: null, confidence: null, source: null },
    ]);
  });

  it("marks a leftover as orphan-resolved when present in the orphans param", () => {
    const bc = [{ id: "b1", name: "Solo Basecamp Club", people: [] }];
    const es: { id: string; name: string; people: unknown[] }[] = [];

    const pairs = matchClubs(bc, es, [], [], false, [{ basecampClubId: "b1", easyspeakClubId: null, orphanedAt: 0 }]);
    const solo = pairs.find((p) => p.basecamp?.id === "b1")!;
    expect(solo.easyspeak).toBeNull();
    expect(solo.confidence).toBe("confirmed");
    expect(solo.source).toBe("orphan");

    const withoutOrphan = matchClubs(bc, es);
    const soloUnresolved = withoutOrphan.find((p) => p.basecamp?.id === "b1")!;
    expect(soloUnresolved.confidence).toBeNull();
  });
});

describe("matchMembers", () => {
  const basecampPeople = [
    { userId: 1, name: "Alice Wonder", paths: [] },
    { userId: 2, name: "Bob Sample", paths: [] },
  ];
  const easyspeakPeople = [
    { memberId: "a", name: "Someone Else Entirely", paths: [] },
    { memberId: "b", name: "Bob Sample", paths: [] },
  ];

  it("honors a confirmed memberLinks pin over a fresh name score", () => {
    const pairs = matchMembers(basecampPeople, easyspeakPeople, [
      { basecampUserId: 1, easyspeakMemberId: "a", source: "manual-search", confirmedAt: 0 },
    ]);
    const pair = pairs.find((p) => p.basecamp?.userId === 1)!;
    expect(pair.easyspeak!.memberId).toBe("a");
    expect(pair.confidence).toBe("confirmed");
    expect(pair.source).toBe("manual-search");
  });

  it("excludes a rejected pair from candidate generation", () => {
    const pairs = matchMembers(basecampPeople, easyspeakPeople, [], [{ basecampUserId: 2, easyspeakMemberId: "b", rejectedAt: 0 }]);
    const bob = pairs.find((p) => p.basecamp?.userId === 2)!;
    expect(bob.easyspeak).toBeNull();
    const es = pairs.find((p) => p.easyspeak?.memberId === "b")!;
    expect(es.basecamp).toBeNull();
  });

  it("marks a leftover as orphan-resolved when present in the orphans param", () => {
    const pairs = matchMembers(basecampPeople, easyspeakPeople, [], [], true, [{ basecampUserId: 1, easyspeakMemberId: null, orphanedAt: 0 }]);
    const alice = pairs.find((p) => p.basecamp?.userId === 1)!;
    expect(alice.easyspeak).toBeNull();
    expect(alice.confidence).toBe("confirmed");
    expect(alice.source).toBe("orphan");

    const withoutOrphan = matchMembers(basecampPeople, easyspeakPeople);
    const aliceUnresolved = withoutOrphan.find((p) => p.basecamp?.userId === 1)!;
    expect(aliceUnresolved.confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildReport against the synthetic fixtures
// ---------------------------------------------------------------------------

describe("buildReport (synthetic fixtures)", () => {
  const report = buildReport(basecampData, easyspeakData, { basecampScrapedAt: 1, easyspeakScrapedAt: 2 });

  it("produces one matched club pair and one leftover club per source", () => {
    expect(report.clubPairs).toHaveLength(3);
    const riverside = findClubPair(report, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    expect(riverside).toBeTruthy();
    expect(riverside.matchScore).toBe(1);
    expect(riverside.clubMatchForced).toBe(false);

    const basecampOnly = findClubPair(report, { basecampClubName: "Basecamp Only Club" });
    expect(basecampOnly.easyspeakClubId).toBeNull();

    const easyspeakOnly = findClubPair(report, { easyspeakClubName: "Easyspeak Only Club" });
    expect(easyspeakOnly.basecampClubId).toBeNull();
  });

  const riverside = findClubPair(report, {
    basecampClubName: "Riverside Toastmasters",
    easyspeakClubName: "Riverside Toastmasters",
  });

  it("matches an identical name exactly", () => {
    const grace = findMember(riverside, { basecampName: "Grace Thompson", easyspeakName: "Grace Thompson" });
    expect(grace.presence).toBe("both");
    expect(grace.matchConfidence).toBe("exact");
  });

  it("resolves a path pair only reachable through PATH_ALIASES", () => {
    const marcus = findMember(riverside, { basecampName: "Marcus Delacroix", easyspeakName: "Marcus Delacroix" });
    const path = marcus.paths.find((p: PathReport) => p.presence === "both")!;
    expect(path.basecampPathName).toBe("Effective Coaching");
    expect(path.easyspeakPathLabel).toBe("Coaching efficace");
  });

  it("matches a near-duplicate spelling above the fuzzy threshold by default", () => {
    const owen = findMember(riverside, { basecampName: "Owen Bright", easyspeakName: "Owen Brights" });
    expect(owen.presence).toBe("both");
    expect(owen.matchConfidence).toBe("fuzzy");
  });

  it("leaves a below-threshold pair as two separate unmatched entries", () => {
    const priya = findMember(riverside, { basecampName: "Priya Chandrasekaran", easyspeakName: null });
    expect(priya.presence).toBe("basecamp-only");
    const other = findMember(riverside, { basecampName: null, easyspeakName: "Someone Completely Different" });
    expect(other.presence).toBe("easyspeak-only");
  });

  it("flags a member whose paths are orphaned on both sides despite an exact name match", () => {
    const helena = findMember(riverside, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(helena.matchConfidence).toBe("exact");
    expect(hasOrphanedPaths(helena)).toBe(true);
    expect(helena.hasOrphanedPaths).toBe(true);
    expect(hasPathOverride(helena)).toBe(false);
  });

  it("drops fuzzy candidates entirely when allowFuzzyMemberMatches is false", () => {
    const strict = buildReport(basecampData, easyspeakData, {}, { allowFuzzyMemberMatches: false });
    const strictRiverside = findClubPair(strict, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    const owenBc = findMember(strictRiverside, { basecampName: "Owen Bright", easyspeakName: null });
    const owenEs = findMember(strictRiverside, { basecampName: null, easyspeakName: "Owen Brights" });
    expect(owenBc.presence).toBe("basecamp-only");
    expect(owenEs.presence).toBe("easyspeak-only");
  });

  it("resolves a member-scoped path override and reports it via hasPathOverride", () => {
    const overridden = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathOverrides: [
          {
            basecampUserId: 9005,
            easyspeakMemberId: "305",
            basecampPathName: "Strategic Relationships",
            easyspeakPathLabel: "Team Collaboration",
            boundAt: 0,
          },
        ],
      }
    );
    const club = findClubPair(overridden, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(hasOrphanedPaths(helena)).toBe(false);
    expect(hasPathOverride(helena)).toBe(true);
    const boundPath = helena.paths.find((p: PathReport) => p.overridden)!;
    expect(boundPath.presence).toBe("both");
  });

  it("keeps flagging a path issue until every real candidate on both sides is resolved, not just the first one", () => {
    const orphaned = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathOrphans: [
          {
            basecampUserId: 9005,
            easyspeakMemberId: "305",
            basecampPathName: "Strategic Relationships",
            easyspeakPathLabel: null,
            orphanedAt: 0,
          },
        ],
      }
    );
    const club = findClubPair(orphaned, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(hasPathOrphan(helena)).toBe(true);
    const orphanPath = helena.paths.find((p: PathReport) => p.orphaned)!;
    expect(orphanPath.presence).toBe("basecamp-only");
    // Helena's EasySpeak-only "Team Collaboration" is still unresolved — marking
    // just the Basecamp side as an orphan must not clear the member's flag.
    expect(hasOrphanedPaths(helena)).toBe(true);

    const bothResolved = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathOrphans: [
          { basecampUserId: 9005, easyspeakMemberId: "305", basecampPathName: "Strategic Relationships", easyspeakPathLabel: null, orphanedAt: 0 },
          { basecampUserId: 9005, easyspeakMemberId: "305", basecampPathName: null, easyspeakPathLabel: "Team Collaboration", orphanedAt: 0 },
        ],
      }
    );
    const clubBothResolved = findClubPair(bothResolved, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    const helenaBothResolved = findMember(clubBothResolved, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(hasOrphanedPaths(helenaBothResolved)).toBe(false);
  });

  it("flagging one side of a mismatched pair defers it without clearing the other side's unresolved flag", () => {
    const flagged = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathFlags: [
          { basecampUserId: 9005, easyspeakMemberId: "305", basecampPathName: "Strategic Relationships", easyspeakPathLabel: null, flaggedAt: 0 },
        ],
      }
    );
    const club = findClubPair(flagged, { basecampClubName: "Riverside Toastmasters", easyspeakClubName: "Riverside Toastmasters" });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });

    expect(hasFlaggedPaths(helena)).toBe(true);
    // The EasySpeak-only "Team Collaboration" side is still a genuine
    // unresolved mismatch — flagging only the Basecamp side must not clear it.
    expect(hasOrphanedPaths(helena)).toBe(true);
    const tags = classifyMember(helena);
    expect(tags).toContain("flagged");
    expect(tags).not.toContain("resolved-manually");
  });

  it("clears hasOrphanedPaths/needsAction once both sides of a mismatch are flagged, without tagging resolved-manually", () => {
    const bothFlagged = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathFlags: [
          { basecampUserId: 9005, easyspeakMemberId: "305", basecampPathName: "Strategic Relationships", easyspeakPathLabel: null, flaggedAt: 0 },
          { basecampUserId: 9005, easyspeakMemberId: "305", basecampPathName: null, easyspeakPathLabel: "Team Collaboration", flaggedAt: 0 },
        ],
      }
    );
    const club = findClubPair(bothFlagged, { basecampClubName: "Riverside Toastmasters", easyspeakClubName: "Riverside Toastmasters" });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });

    expect(hasOrphanedPaths(helena)).toBe(false);
    expect(needsAction(helena)).toBe(false);
    const tags = classifyMember(helena);
    expect(tags).toContain("flagged");
    expect(tags).not.toContain("resolved-manually");
    expect(tags).not.toContain("path-issues");
  });

  it("does not let a flagged path on one side mask a genuine, unrelated unresolved mismatch on the other", () => {
    // hasOrphanedPaths() only looks at the EasySpeak-only side, so a flagged
    // Basecamp-only path never has any bearing on it — this pins that down
    // with a synthetic member shape: one flagged basecamp-only path plus a
    // separate, unrelated, unresolved easyspeak-only path (different
    // canonical key). The unresolved easyspeak-only path alone must still
    // report true, regardless of the unrelated basecamp-only path's state.
    const paths: PathReport[] = [
      {
        canonicalKey: "flagged-path",
        displayName: "Flagged Path",
        basecampPathName: "Flagged Path",
        easyspeakPathLabel: null,
        presence: "basecamp-only",
        nonPathway: false,
        overridden: false,
        orphaned: false,
        flagged: true,
        completedHistory: false,
        manuallyCompleted: false,
        levels: [],
        pathCompletion: null,
      },
      {
        canonicalKey: "unrelated-path",
        displayName: "Unrelated Path",
        basecampPathName: null,
        easyspeakPathLabel: "Unrelated Path",
        presence: "easyspeak-only",
        nonPathway: false,
        overridden: false,
        orphaned: false,
        flagged: false,
        completedHistory: false,
        manuallyCompleted: false,
        levels: [],
        pathCompletion: null,
      },
    ];
    expect(hasOrphanedPaths({ presence: "both", paths })).toBe(true);
  });

  it("marks an easyspeak-only path manuallyCompleted, clears hasOrphanedPaths, and excludes it from the Next Level Summary", () => {
    const completed = buildReport(
      basecampData,
      easyspeakData,
      {},
      {
        memberPathCompletions: [{ basecampUserId: 9005, easyspeakMemberId: "305", easyspeakPathLabel: "Team Collaboration", completedAt: 0 }],
      }
    );
    const club = findClubPair(completed, { basecampClubName: "Riverside Toastmasters", easyspeakClubName: "Riverside Toastmasters" });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    const completedPath = helena.paths.find((p: PathReport) => p.easyspeakPathLabel === "Team Collaboration")!;
    expect(completedPath.manuallyCompleted).toBe(true);

    // The Basecamp-only "Strategic Relationships" side is still unresolved,
    // but hasOrphanedPaths() only looks at the EasySpeak-only side — with
    // "Team Collaboration" manually completed there's no unresolved
    // EasySpeak-only candidate left, so the member stops flagging as a path
    // issue regardless of the Basecamp-only leftover (same reasoning
    // completedHistory already relies on: a Basecamp-only path with nothing
    // on the EasySpeak side isn't itself actionable).
    expect(hasOrphanedPaths(helena)).toBe(false);

    const summary = buildLevelSummary(completed);
    const riversideSummary = summary.find((s) => s.clubName === "Riverside Toastmasters")!;
    expect(riversideSummary.rows.some((r) => r.memberName === "Helena Voss" && r.pathName === "Team Collaboration")).toBe(false);
  });

  it("computes a level summary reflecting Basecamp-approved progress", () => {
    const summary = buildLevelSummary(report);
    const riversideSummary = summary.find((s) => s.clubName === "Riverside Toastmasters")!;
    const graceRow = riversideSummary.rows.find((r) => r.memberName === "Grace Thompson")!;
    expect(graceRow.currentLevelLabel).toBe("Level 2");
    expect(graceRow.nextLevelLabel).toBe("Level 3");
  });
});

// ---------------------------------------------------------------------------
// compareLevelSummaryRows — Club Progress's "Next Level Summary" table sort
// ---------------------------------------------------------------------------

describe("compareLevelSummaryRows", () => {
  function makeRow(overrides: Partial<LevelSummaryRow>): LevelSummaryRow {
    return {
      memberKey: "member",
      pathKey: "path",
      memberName: "Member",
      memberPresence: "both",
      matchConfidence: "exact",
      pathName: "Path",
      pathPresence: "both",
      pendingReview: false,
      currentLevel: 1,
      currentLevelSortValue: 1,
      currentLevelLabel: "Level 1",
      nextLevelLabel: "Level 2",
      theoreticalMissing: 1,
      unreportedInBasecamp: 0,
      realMissing: 1,
      status: "in-progress",
      statusDetail: "1 speech remaining",
      statusSortRank: 3,
      ...overrides,
    };
  }

  it("groups both-presence rows first, then Basecamp-only, then EasySpeak-only, regardless of the sorted column's values", () => {
    // realMissing is deliberately set so a naive column-only sort would put
    // these in the opposite order (easyspeak-only first) — presence grouping
    // must win regardless.
    const bothRow = makeRow({ pathKey: "both", pathPresence: "both", realMissing: 3 });
    const basecampOnlyRow = makeRow({ pathKey: "basecamp-only", pathPresence: "basecamp-only", realMissing: 2 });
    const easyspeakOnlyRow = makeRow({ pathKey: "easyspeak-only", pathPresence: "easyspeak-only", realMissing: 1 });

    const sorted = [easyspeakOnlyRow, basecampOnlyRow, bothRow].sort((a, b) => compareLevelSummaryRows(a, b, "realMissing", "asc"));

    expect(sorted.map((r) => r.pathPresence)).toEqual(["both", "basecamp-only", "easyspeak-only"]);
  });

  it("sorts by the picked column within a shared presence group", () => {
    const rowA = makeRow({ pathKey: "a", pathPresence: "both", realMissing: 3 });
    const rowB = makeRow({ pathKey: "b", pathPresence: "both", realMissing: 1 });
    const rowC = makeRow({ pathKey: "c", pathPresence: "both", realMissing: 2 });

    const asc = [rowA, rowB, rowC].sort((a, b) => compareLevelSummaryRows(a, b, "realMissing", "asc"));
    expect(asc.map((r) => r.pathKey)).toEqual(["b", "c", "a"]);

    const desc = [rowA, rowB, rowC].sort((a, b) => compareLevelSummaryRows(a, b, "realMissing", "desc"));
    expect(desc.map((r) => r.pathKey)).toEqual(["a", "c", "b"]);
  });

  it("sorts a null value in the picked column last within its own presence group, not globally last", () => {
    const bothWithNull = makeRow({ pathKey: "both-null", pathPresence: "both", realMissing: null });
    const bothWithValue = makeRow({ pathKey: "both-value", pathPresence: "both", realMissing: 1 });
    const basecampOnlyRow = makeRow({ pathKey: "basecamp-only", pathPresence: "basecamp-only", realMissing: 0 });

    const sorted = [basecampOnlyRow, bothWithNull, bothWithValue].sort((a, b) => compareLevelSummaryRows(a, b, "realMissing", "asc"));

    expect(sorted.map((r) => r.pathKey)).toEqual(["both-value", "both-null", "basecamp-only"]);
  });

  it("when sorting by Status, breaks ties among 'needs-reporting' rows by smallest remaining-count-once-reported first", () => {
    const many = makeRow({ pathKey: "many", status: "needs-reporting", statusSortRank: 2, realMissing: 4 });
    const few = makeRow({ pathKey: "few", status: "needs-reporting", statusSortRank: 2, realMissing: 1 });
    const some = makeRow({ pathKey: "some", status: "needs-reporting", statusSortRank: 2, realMissing: 2 });

    const sorted = [many, few, some].sort((a, b) => compareLevelSummaryRows(a, b, "statusSortRank", "asc"));

    expect(sorted.map((r) => r.pathKey)).toEqual(["few", "some", "many"]);
  });

  it("when sorting by Status, breaks ties among 'in-progress' rows by smallest speeches-remaining count first", () => {
    const many = makeRow({ pathKey: "many", status: "in-progress", statusSortRank: 3, realMissing: 4 });
    const few = makeRow({ pathKey: "few", status: "in-progress", statusSortRank: 3, realMissing: 1 });
    const some = makeRow({ pathKey: "some", status: "in-progress", statusSortRank: 3, realMissing: 2 });

    const sorted = [many, few, some].sort((a, b) => compareLevelSummaryRows(a, b, "statusSortRank", "asc"));

    expect(sorted.map((r) => r.pathKey)).toEqual(["few", "some", "many"]);
  });
});

// ---------------------------------------------------------------------------
// computeLevelSummary — the Status/Detail badges shown in Club Progress's
// "Next Level Summary"/"Pending review" tables. Levels/paths below are
// constructed directly (not via diffLevel()) to isolate computeLevelSummary's
// own branching logic from the LevelDiff fixtures feeding it.
// ---------------------------------------------------------------------------

describe("computeLevelSummary status", () => {
  function makeLevel(level: number, overrides: Partial<LevelDiff> = {}): LevelDiff {
    return {
      level,
      easyspeak: null,
      basecamp: null,
      easyspeakMissing: null,
      basecampMissing: null,
      discrepancy: null,
      pendingValidation: false,
      ...overrides,
    };
  }

  function makePath(overrides: Partial<PathReport> = {}): PathReport {
    return {
      canonicalKey: "path",
      displayName: "Path",
      basecampPathName: "Path",
      easyspeakPathLabel: "Path",
      presence: "both",
      nonPathway: false,
      overridden: false,
      orphaned: false,
      flagged: false,
      completedHistory: false,
      manuallyCompleted: false,
      levels: [],
      pathCompletion: null,
      ...overrides,
    };
  }

  it("is 'ready' when nothing is missing per Basecamp itself", () => {
    const path = makePath({ levels: [makeLevel(1)] });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("ready");
    expect(summary.statusDetail).toBe("All requirements reported");
  });

  it("is 'in-progress' when speeches remain and nothing else is flagged", () => {
    const path = makePath({ levels: [makeLevel(1, { basecamp: { completed: 2, total: 5, approved: false }, basecampMissing: 3 })] });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("in-progress");
    expect(summary.statusDetail).toBe("3 speeches remaining");
  });

  it("is 'needs-reporting' when EasySpeak is ahead of Basecamp but a real gap remains", () => {
    const path = makePath({
      levels: [
        makeLevel(1, {
          easyspeak: { needed: 5, done: 3 },
          basecamp: { completed: 1, total: 5, approved: false },
          easyspeakMissing: 2,
          basecampMissing: 4,
          discrepancy: 2,
        }),
      ],
    });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("needs-reporting");
    expect(summary.statusDetail).toBe("4 speeches remaining → 2 if reported");
  });

  it("is 'ready-if-reported' when reporting the unreported speeches would close the gap", () => {
    const path = makePath({
      levels: [
        makeLevel(1, {
          easyspeak: { needed: 5, done: 5 },
          basecamp: { completed: 3, total: 5, approved: false },
          easyspeakMissing: 0,
          basecampMissing: 2,
          discrepancy: 2,
        }),
      ],
    });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("ready-if-reported");
    expect(summary.statusDetail).toBe("2 speeches remaining → 0 if reported");
  });

  it("is 'completed' once Level 5 and Path Completion are both done", () => {
    const path = makePath({
      levels: [makeLevel(5, { basecamp: { completed: 5, total: 5, approved: true } })],
      pathCompletion: { completed: 1, total: 1, missing: 0 },
    });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("completed");
    expect(summary.statusDetail).toBe("Path completed");
  });

  it("is 'not-tracked' for an EasySpeak-only path", () => {
    const path = makePath({ presence: "easyspeak-only" });
    const summary = computeLevelSummary(path);
    expect(summary.status).toBe("not-tracked");
    expect(summary.statusDetail).toBe("Only in EasySpeak, not yet in Basecamp");
  });
});

// ---------------------------------------------------------------------------
// isMemberResolved / computeMatchSummary — the popup's "Matches: X/Y" stat
// ---------------------------------------------------------------------------

describe("isMemberResolved", () => {
  it("counts an exact match with no path issues as resolved", () => {
    expect(isMemberResolved({ matchConfidence: "exact", hasOrphanedPaths: false })).toBe(true);
  });

  it("excludes a fuzzy (still-unconfirmed) suggestion — it's an unreviewed guess, not a settled match", () => {
    expect(isMemberResolved({ matchConfidence: "fuzzy", hasOrphanedPaths: false })).toBe(false);
  });

  it("excludes an exact match with an unresolved path issue", () => {
    expect(isMemberResolved({ matchConfidence: "exact", hasOrphanedPaths: true })).toBe(false);
  });

  it("counts a member explicitly resolved as an Orphan (or a manually-confirmed link)", () => {
    expect(isMemberResolved({ matchConfidence: "confirmed", hasOrphanedPaths: false })).toBe(true);
  });

  it("excludes a plain unmatched member", () => {
    expect(isMemberResolved({ matchConfidence: null, hasOrphanedPaths: false })).toBe(false);
  });
});

describe("computeMatchSummary (synthetic fixtures)", () => {
  it("excludes a fuzzy suggestion and an exact match that still has an unresolved path issue", () => {
    const report = buildReport(basecampData, easyspeakData);
    const club = findClubPair(report, { basecampClubName: "Riverside Toastmasters", easyspeakClubName: "Riverside Toastmasters" });

    const owen = findMember(club, { basecampName: "Owen Bright", easyspeakName: "Owen Brights" });
    expect(owen.matchConfidence).toBe("fuzzy");
    expect(isMemberResolved(owen)).toBe(false);

    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(helena.hasOrphanedPaths).toBe(true);
    expect(isMemberResolved(helena)).toBe(false);
  });

  it("aggregates matched/total across every club, excluding unmatched/fuzzy members and Helena's path issue", () => {
    const report = buildReport(basecampData, easyspeakData);
    const summary = computeMatchSummary(report);
    // Riverside (8: Grace/Marcus exact+resolved, Owen fuzzy-excluded, Helena
    // exact but path-issue-excluded, Priya/Samuel/Someone Completely
    // Different/Nadia unmatched) + Basecamp Only Club (1: Ingrid, unmatched)
    // + Easyspeak Only Club (1: Tomasz, unmatched) = 10 total, 2 resolved.
    expect(summary.total).toBe(10);
    expect(summary.matched).toBe(2);
  });

  it("matched count increases once an unmatched member is resolved as an Orphan", () => {
    const report = buildReport(basecampData, easyspeakData, {}, {
      memberOrphans: [{ basecampUserId: 9004, easyspeakMemberId: null, orphanedAt: 0 }], // Priya Chandrasekaran
    });
    const summary = computeMatchSummary(report);
    expect(summary.total).toBe(10);
    expect(summary.matched).toBe(3);
  });

  it("tags an acknowledged one-sided club orphaned (not clubMatchForced) via buildReport's resolution param", () => {
    const withoutOrphan = buildReport(basecampData, easyspeakData);
    const soloUnresolved = findClubPair(withoutOrphan, { basecampClubName: "Basecamp Only Club", easyspeakClubName: null });
    expect(soloUnresolved.clubOrphaned).toBe(false);
    expect(soloUnresolved.clubMatchForced).toBe(false);

    const report = buildReport(basecampData, easyspeakData, {}, {
      clubOrphans: [{ basecampClubId: "bcclub-onlyclub", easyspeakClubId: null, orphanedAt: 0 }],
    });
    const solo = findClubPair(report, { basecampClubName: "Basecamp Only Club", easyspeakClubName: null });
    expect(solo.clubOrphaned).toBe(true);
    expect(solo.clubMatchForced).toBe(false);
  });

  it("matched count increases once a path-orphaned member's path issue is bound", () => {
    const report = buildReport(basecampData, easyspeakData, {}, {
      memberPathOverrides: [
        {
          basecampUserId: 9005,
          easyspeakMemberId: "305",
          basecampPathName: "Strategic Relationships",
          easyspeakPathLabel: "Team Collaboration",
          boundAt: 0,
        },
      ],
    });
    const summary = computeMatchSummary(report);
    expect(summary.total).toBe(10);
    expect(summary.matched).toBe(3);
  });

  it("a fuzzy suggestion still doesn't count until it's actually confirmed, even once everything else is resolved", () => {
    const report = buildReport(basecampData, easyspeakData, {}, {
      memberOrphans: [
        { basecampUserId: 9004, easyspeakMemberId: null, orphanedAt: 0 }, // Priya Chandrasekaran
        { basecampUserId: 9006, easyspeakMemberId: null, orphanedAt: 0 }, // Samuel Osei
        { basecampUserId: null, easyspeakMemberId: "304", orphanedAt: 0 }, // Someone Completely Different
        { basecampUserId: null, easyspeakMemberId: "306", orphanedAt: 0 }, // Nadia Okafor
        { basecampUserId: 9101, easyspeakMemberId: null, orphanedAt: 0 }, // Ingrid Solberg
        { basecampUserId: null, easyspeakMemberId: "401", orphanedAt: 0 }, // Tomasz Nowak
      ],
      memberPathOverrides: [
        {
          basecampUserId: 9005,
          easyspeakMemberId: "305",
          basecampPathName: "Strategic Relationships",
          easyspeakPathLabel: "Team Collaboration",
          boundAt: 0,
        },
      ],
    });
    const summary = computeMatchSummary(report);
    // Owen Bright/Owen Brights is still an unconfirmed fuzzy suggestion, so
    // it alone keeps the ratio short of total/total.
    expect(summary.matched).toBe(summary.total - 1);
  });

  it("matched count reaches total once the fuzzy suggestion is confirmed too", () => {
    const report = buildReport(basecampData, easyspeakData, {}, {
      memberLinks: [{ basecampUserId: 9003, easyspeakMemberId: "303", source: "fuzzy-confirmed", confirmedAt: 0 }], // Owen Bright / Owen Brights
      memberOrphans: [
        { basecampUserId: 9004, easyspeakMemberId: null, orphanedAt: 0 }, // Priya Chandrasekaran
        { basecampUserId: 9006, easyspeakMemberId: null, orphanedAt: 0 }, // Samuel Osei
        { basecampUserId: null, easyspeakMemberId: "304", orphanedAt: 0 }, // Someone Completely Different
        { basecampUserId: null, easyspeakMemberId: "306", orphanedAt: 0 }, // Nadia Okafor
        { basecampUserId: 9101, easyspeakMemberId: null, orphanedAt: 0 }, // Ingrid Solberg
        { basecampUserId: null, easyspeakMemberId: "401", orphanedAt: 0 }, // Tomasz Nowak
      ],
      memberPathOverrides: [
        {
          basecampUserId: 9005,
          easyspeakMemberId: "305",
          basecampPathName: "Strategic Relationships",
          easyspeakPathLabel: "Team Collaboration",
          boundAt: 0,
        },
      ],
    });
    const summary = computeMatchSummary(report);
    expect(summary.matched).toBe(summary.total);
  });
});
