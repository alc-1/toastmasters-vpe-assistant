import { describe, expect, it } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const {
  buildReport,
  normalizeClubName,
  clubNameScore,
  matchClubs,
  normalizeName,
  levenshtein,
  nameScore,
  matchMembers,
  canonicalizePathName,
  matchPaths,
  hasOrphanedPaths,
  hasPathOverride,
  diffLevel,
  reportToRows,
  toCsv,
  computeLevelSummary,
  buildLevelSummary,
} = require("../lib/report.js");

const DATA_DIR = path.join(__dirname, "..", "test-data", "report");
const basecampData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "basecampData.sample.json"), "utf8"));
const easyspeakData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "easyspeakData.sample.json"), "utf8"));

function findClubPair(report, { basecampClubName, easyspeakClubName }) {
  return report.clubPairs.find(
    (c) => c.basecampClubName === (basecampClubName ?? null) && c.easyspeakClubName === (easyspeakClubName ?? null)
  );
}

function findMember(club, { basecampName, easyspeakName }) {
  return club.members.find(
    (m) => m.basecampName === (basecampName ?? null) && m.easyspeakName === (easyspeakName ?? null)
  );
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
    const diff = diffLevel(1, { needed: 2, done: 2 }, { completed: 2, total: 2, approved: false });
    expect(diff.pendingValidation).toBe(true);
    expect(diff.discrepancy).toBe(0);
  });

  it("does not flag pendingValidation once Basecamp has approved it", () => {
    const diff = diffLevel(1, { needed: 2, done: 2 }, { completed: 2, total: 2, approved: true });
    expect(diff.pendingValidation).toBe(false);
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
    expect(pairs).toEqual([{ basecamp: expect.any(Object), easyspeak: expect.any(Object), score: 1, forced: false }]);
  });

  it("forces a pin from clubLookup even without a name match", () => {
    const pairs = matchClubs(
      [{ id: "b1", name: "Basecamp Name", people: [] }],
      [{ id: "e1", name: "Totally Different Name", people: [] }],
      [{ basecampClubId: "b1", easyspeakClubId: "e1" }]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ score: null, forced: true });
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
      { basecampUserId: 1, easyspeakMemberId: "a", source: "manual-search" },
    ]);
    const pair = pairs.find((p) => p.basecamp?.userId === 1);
    expect(pair.easyspeak.memberId).toBe("a");
    expect(pair.confidence).toBe("confirmed");
    expect(pair.source).toBe("manual-search");
  });

  it("excludes a rejected pair from candidate generation", () => {
    const pairs = matchMembers(basecampPeople, easyspeakPeople, [], [{ basecampUserId: 2, easyspeakMemberId: "b" }]);
    const bob = pairs.find((p) => p.basecamp?.userId === 2);
    expect(bob.easyspeak).toBeNull();
    const es = pairs.find((p) => p.easyspeak?.memberId === "b");
    expect(es.basecamp).toBeNull();
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
    const path = marcus.paths.find((p) => p.presence === "both");
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
    const overridden = buildReport(basecampData, easyspeakData, {}, {
      memberPathOverrides: [
        {
          basecampUserId: 9005,
          easyspeakMemberId: "305",
          basecampPathName: "Strategic Relationships",
          easyspeakPathLabel: "Team Collaboration",
        },
      ],
    });
    const club = findClubPair(overridden, {
      basecampClubName: "Riverside Toastmasters",
      easyspeakClubName: "Riverside Toastmasters",
    });
    const helena = findMember(club, { basecampName: "Helena Voss", easyspeakName: "Helena Voss" });
    expect(hasOrphanedPaths(helena)).toBe(false);
    expect(hasPathOverride(helena)).toBe(true);
    const boundPath = helena.paths.find((p) => p.overridden);
    expect(boundPath.presence).toBe("both");
  });

  it("round-trips through reportToRows/toCsv without throwing, header row intact", () => {
    const rows = reportToRows(report);
    expect(rows[0][0]).toBe("Basecamp Club");
    const csv = toCsv(rows);
    expect(csv.split("\r\n")).toHaveLength(rows.length);
  });

  it("computes a level summary reflecting Basecamp-approved progress", () => {
    const summary = buildLevelSummary(report);
    const riversideSummary = summary.find((s) => s.clubName === "Riverside Toastmasters");
    const graceRow = riversideSummary.rows.find((r) => r.memberName === "Grace Thompson");
    expect(graceRow.currentLevelLabel).toBe("Level 2");
    expect(graceRow.nextLevelLabel).toBe("Level 3");
  });
});
