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
  computeMatchSummary,
  hasOrphanedPaths,
  hasPathOrphan,
  hasPathOverride,
  isMemberResolved,
  reportToRows,
  toCsv,
} from "../src/shared/sync/delta";
import type { BasecampScrape, ClubPairReport, EasySpeakScrape, MemberReport, PathReport } from "../src/shared/types";

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
});

describe("toCsv", () => {
  it("quotes fields containing commas/quotes and doubles embedded quotes", () => {
    expect(toCsv([["a", "b,c", 'd"e']])).toBe('a,"b,c","d""e"');
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

  it("resolves a member-scoped path orphan and reports it via hasPathOrphan / PathReport.orphaned", () => {
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
    expect(hasOrphanedPaths(helena)).toBe(false);
    expect(hasPathOrphan(helena)).toBe(true);
    const orphanPath = helena.paths.find((p: PathReport) => p.orphaned)!;
    expect(orphanPath.presence).toBe("basecamp-only");
  });

  it("round-trips through reportToRows/toCsv without throwing, header row intact", () => {
    const rows = reportToRows(report);
    expect(rows[0][0]).toBe("Basecamp Club");
    const csv = toCsv(rows);
    expect(csv.split("\r\n")).toHaveLength(rows.length);
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
