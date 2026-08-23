import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReport, computeMatchSummary, countBasecampMembers, countEasySpeakMembers } from "../src/shared/sync/delta";
import {
  buildAggregatedRows,
  buildBasecampRows,
  buildEasySpeakRows,
  buildExportSheets,
  buildMatchesRows,
  buildMetadataRows,
  type MatchesRow,
  type ResolutionRecords,
} from "../src/shared/export/rows";
import type { BasecampScrape, EasySpeakScrape, MemberReport, PathReport, ReportResult } from "../src/shared/types";

const DATA_DIR = fileURLToPath(new URL("../test-data/report/", import.meta.url));
const basecampData: BasecampScrape = JSON.parse(readFileSync(DATA_DIR + "basecampData.sample.json", "utf8"));
const easyspeakData: EasySpeakScrape = JSON.parse(readFileSync(DATA_DIR + "easyspeakData.sample.json", "utf8"));

function emptyResolution(overrides: Partial<ResolutionRecords> = {}): ResolutionRecords {
  return {
    memberLinks: [],
    rejectedPairs: [],
    clubLookup: [],
    clubRejectedPairs: [],
    clubOrphans: [],
    memberOrphans: [],
    memberPathOverrides: [],
    memberPathExclusions: [],
    memberPathOrphans: [],
    memberPathFlags: [],
    memberPathCompletions: [],
    ...overrides,
  };
}

const emptyReport: ReportResult = { meta: { basecampScrapedAt: null, easyspeakScrapedAt: null }, clubPairs: [] };

// ---------------------------------------------------------------------------
// buildAggregatedRows
// ---------------------------------------------------------------------------

describe("buildAggregatedRows", () => {
  const report = buildReport(basecampData, easyspeakData);
  const rows = buildAggregatedRows(report);

  it("emits exactly one row per member×path across every club pair", () => {
    const expectedCount = report.clubPairs
      .flatMap((c) => c.members)
      .reduce((sum, m) => sum + Math.max(m.paths.length, 1), 0);
    expect(rows).toHaveLength(expectedCount);
    // Helena Voss has a mismatched path on each side (basecamp-only +
    // easyspeak-only), so she alone contributes 2 rows, not 1.
    expect(rows.filter((r) => r.memberName === "Helena Voss")).toHaveLength(2);
  });

  it("carries both-source identifiers for traceability back to the Basecamp/EasySpeak sheets", () => {
    const grace = rows.find((r) => r.memberName === "Grace Thompson")!;
    expect(grace.basecampUserId).toBe(9001);
    expect(grace.easyspeakMemberId).toBe("301");
  });

  it("reflects Basecamp-approved progress via computeLevelSummary, matching Club Progress's own numbers", () => {
    const grace = rows.find((r) => r.memberName === "Grace Thompson")!;
    expect(grace.currentLevel).toBe(2);
    expect(grace.currentLevelLabel).toBe("Level 2");
    expect(grace.nextLevelLabel).toBe("Level 3");
    expect(grace.level1BasecampApproved).toBe(true);
    expect(grace.level1EasyspeakDone).toBe(2);
  });

  it("populates Path Completion columns from the path's pathCompletion figures", () => {
    const grace = rows.find((r) => r.memberName === "Grace Thompson")!;
    expect(grace.pathCompletionCompleted).toBe(0);
    expect(grace.pathCompletionTotal).toBe(1);
    expect(grace.pathCompletionMissing).toBe(1);
  });

  it("does not throw for a nonPathway path and leaves its derived-summary columns null", () => {
    // A nonPathway path (e.g. Speechcraft) always has levels: [] by
    // construction (see matchPaths() in shared/sync/conflicts.ts) — calling
    // computeLevelSummary() on it would index into an empty array and throw,
    // so buildAggregatedRows() must skip that call for nonPathway paths.
    const nonPathwayPath: PathReport = {
      canonicalKey: "speechcraft",
      displayName: "Speechcraft",
      basecampPathName: "Speechcraft",
      easyspeakPathLabel: "Speechcraft",
      presence: "both",
      nonPathway: true,
      overridden: false,
      orphaned: false,
      flagged: false,
      completedHistory: false,
      manuallyCompleted: false,
      levels: [],
      pathCompletion: null,
    };
    const member: MemberReport = {
      basecampUserId: 1,
      easyspeakMemberId: "1",
      name: "Test Member",
      basecampName: "Test Member",
      easyspeakName: "Test Member",
      presence: "both",
      matchConfidence: "exact",
      matchScore: 1,
      matchSource: null,
      easyspeakNoActivePath: false,
      paths: [nonPathwayPath],
      hasOrphanedPaths: false,
    };
    const syntheticReport: ReportResult = {
      meta: { basecampScrapedAt: null, easyspeakScrapedAt: null },
      clubPairs: [
        {
          basecampClubId: "c1",
          basecampClubName: "Club",
          easyspeakClubId: "c1",
          easyspeakClubName: "Club",
          matchScore: 1,
          clubMatchForced: false,
          clubOrphaned: false,
          members: [member],
        },
      ],
    };

    expect(() => buildAggregatedRows(syntheticReport)).not.toThrow();
    const [row] = buildAggregatedRows(syntheticReport);
    expect(row.pathDisplayName).toBe("Speechcraft");
    expect(row.nonPathway).toBe(true);
    expect(row.currentLevel).toBeNull();
    expect(row.status).toBeNull();
    expect(row.level1EasyspeakNeeded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildMatchesRows — one inline case per MatchRecordType
// ---------------------------------------------------------------------------

describe("buildMatchesRows", () => {
  it("emits a Club Match row per club pair with a basecamp+easyspeak id", () => {
    const report = buildReport(basecampData, easyspeakData);
    const rows = buildMatchesRows(report, emptyResolution());
    const clubMatches = rows.filter((r) => r.recordType === "Club Match");
    // Only the Riverside pair has both ids — the two leftover clubs never
    // reach the "both ids present" branch.
    expect(clubMatches).toHaveLength(1);
    expect(clubMatches[0].basecampClubName).toBe("Riverside Toastmasters");
    expect(clubMatches[0].easyspeakClubName).toBe("Riverside Toastmasters");
    expect(clubMatches[0].matchScore).toBe(1);
  });

  it("emits a Member Match row for every member, including one-sided leftovers", () => {
    const report = buildReport(basecampData, easyspeakData);
    const rows = buildMatchesRows(report, emptyResolution());
    const memberMatches = rows.filter((r) => r.recordType === "Member Match");
    const totalMembers = report.clubPairs.reduce((sum, c) => sum + c.members.length, 0);
    expect(memberMatches).toHaveLength(totalMembers);

    const grace = memberMatches.find((r) => r.basecampName === "Grace Thompson")!;
    expect(grace.matchConfidence).toBe("exact");
    expect(grace.notes).toBe("Automatic (exact name match)");
    expect(grace.recordedAt).toBeNull(); // no memberLinks entry for a plain automatic match

    const priya = memberMatches.find((r) => r.basecampName === "Priya Chandrasekaran")!;
    expect(priya.presence).toBe("basecamp-only");
    expect(priya.notes).toBe("One-sided: Basecamp only");
  });

  it("recovers a Recorded At timestamp for a Member Match backed by a confirmed memberLinks entry", () => {
    const report = buildReport(
      basecampData,
      easyspeakData,
      {},
      { memberLinks: [{ basecampUserId: 9003, easyspeakMemberId: "303", source: "fuzzy-confirmed", confirmedAt: 1700000000000 }] }
    );
    const resolution = emptyResolution({
      memberLinks: [{ basecampUserId: 9003, easyspeakMemberId: "303", source: "fuzzy-confirmed", confirmedAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(report, resolution);
    const owen = rows.find((r) => r.recordType === "Member Match" && r.basecampName === "Owen Bright")!;
    expect(owen.matchConfidence).toBe("confirmed");
    expect(owen.recordedAt).toBe(new Date(1700000000000).toLocaleString());
    expect(owen.notes).toBe("Confirmed from a suggested match");
  });

  it("emits a Rejected Member Pair row per resolution.rejectedPairs entry", () => {
    const resolution = emptyResolution({ rejectedPairs: [{ basecampUserId: 1, easyspeakMemberId: "e1", rejectedAt: 1700000000000 }] });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([
      expect.objectContaining({ recordType: "Rejected Member Pair", basecampUserId: 1, easyspeakMemberId: "e1", recordedAt: expect.any(String) }),
    ]);
  });

  it("emits a Rejected Club Pair row per resolution.clubRejectedPairs entry", () => {
    const resolution = emptyResolution({ clubRejectedPairs: [{ basecampClubId: "b1", easyspeakClubId: "e1", rejectedAt: 1700000000000 }] });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([
      expect.objectContaining({ recordType: "Rejected Club Pair", basecampClubId: "b1", easyspeakClubId: "e1" }),
    ]);
  });

  it("emits a Member Orphan row per resolution.memberOrphans entry, noting which side is one-sided", () => {
    const resolution = emptyResolution({ memberOrphans: [{ basecampUserId: 1, easyspeakMemberId: null, orphanedAt: 1700000000000 }] });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([
      expect.objectContaining({ recordType: "Member Orphan", basecampUserId: 1, easyspeakMemberId: null, notes: "One-sided: Basecamp only" }),
    ]);
  });

  it("emits a Path Override row per resolution.memberPathOverrides entry", () => {
    const resolution = emptyResolution({
      memberPathOverrides: [{ basecampUserId: 1, easyspeakMemberId: "e1", basecampPathName: "A", easyspeakPathLabel: "B", boundAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([
      expect.objectContaining({ recordType: "Path Override", basecampPathName: "A", easyspeakPathLabel: "B", presence: "both", forced: true }),
    ]);
  });

  it("emits a Path Exclusion row per resolution.memberPathExclusions entry", () => {
    const resolution = emptyResolution({
      memberPathExclusions: [{ basecampUserId: 1, easyspeakMemberId: "e1", basecampPathName: "A", easyspeakPathLabel: "B", excludedAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([expect.objectContaining({ recordType: "Path Exclusion", basecampPathName: "A", easyspeakPathLabel: "B" })]);
  });

  it("emits a Path Orphan row per resolution.memberPathOrphans entry, noting which side is one-sided", () => {
    const resolution = emptyResolution({
      memberPathOrphans: [{ basecampUserId: 1, easyspeakMemberId: "e1", basecampPathName: "A", easyspeakPathLabel: null, orphanedAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([
      expect.objectContaining({ recordType: "Path Orphan", basecampPathName: "A", easyspeakPathLabel: null, notes: "One-sided: Basecamp only" }),
    ]);
  });

  it("emits a Path Flag row per resolution.memberPathFlags entry", () => {
    const resolution = emptyResolution({
      memberPathFlags: [{ basecampUserId: 1, easyspeakMemberId: "e1", basecampPathName: null, easyspeakPathLabel: "B", flaggedAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([expect.objectContaining({ recordType: "Path Flag", basecampPathName: null, easyspeakPathLabel: "B" })]);
  });

  it("emits a Path Completion row per resolution.memberPathCompletions entry", () => {
    const resolution = emptyResolution({
      memberPathCompletions: [{ basecampUserId: 1, easyspeakMemberId: "e1", easyspeakPathLabel: "B", completedAt: 1700000000000 }],
    });
    const rows = buildMatchesRows(emptyReport, resolution);
    expect(rows).toEqual<MatchesRow[]>([expect.objectContaining({ recordType: "Path Completion", easyspeakPathLabel: "B" })]);
  });
});

// ---------------------------------------------------------------------------
// buildBasecampRows / buildEasySpeakRows — raw, unaggregated source sheets
// ---------------------------------------------------------------------------

describe("buildBasecampRows", () => {
  it("emits one row per stored member×path row, not deduped by user id", () => {
    const rows = buildBasecampRows(basecampData);
    const totalRawMembers = Object.values(basecampData).reduce((sum, club) => sum + club.members.length, 0);
    expect(rows).toHaveLength(totalRawMembers);
  });

  it("round-trips the full raw record through rawRecordJson", () => {
    const rows = buildBasecampRows(basecampData);
    const grace = rows.find((r) => r.basecampUserId === 9001)!;
    expect(grace.level1Completed).toBe(2);
    expect(grace.level1Approved).toBe(true);
    expect(grace.pathCompletionTotal).toBe(1);
    const original = basecampData["bcclub-riverside"].members.find((m) => m.user.id === 9001)!;
    expect(JSON.parse(grace.rawRecordJson)).toEqual(original);
  });
});

describe("buildEasySpeakRows", () => {
  it("emits one row per stored member row, not deduped by member id", () => {
    const rows = buildEasySpeakRows(easyspeakData);
    const totalRawMembers = Object.values(easyspeakData).reduce((sum, club) => sum + club.members.length, 0);
    expect(rows).toHaveLength(totalRawMembers);
  });

  it("round-trips the full levels array through rawLevelsJson", () => {
    const rows = buildEasySpeakRows(easyspeakData);
    const grace = rows.find((r) => r.easyspeakMemberId === "301")!;
    expect(grace.level1Needed).toBe(2);
    expect(grace.level1Done).toBe(2);
    const original = easyspeakData["201"].members.find((m) => m.memberId === "301")!;
    expect(JSON.parse(grace.rawLevelsJson)).toEqual(original.levels);
  });
});

// ---------------------------------------------------------------------------
// buildMetadataRows
// ---------------------------------------------------------------------------

describe("buildMetadataRows", () => {
  const report = buildReport(basecampData, easyspeakData, { basecampScrapedAt: 1700000000000, easyspeakScrapedAt: 1700000100000 });

  it("emits exactly 14 rows in a fixed key order", () => {
    const rows = buildMetadataRows({
      exportedAt: 1700000200000,
      extensionVersion: "0.6.1",
      schemaVersion: "1",
      activeProfileLabel: "Demo",
      exportType: "all",
      basecampScrapedAt: 1700000000000,
      easyspeakScrapedAt: 1700000100000,
      basecampData,
      easyspeakData,
      report,
    });
    expect(rows.map((r) => r.key)).toEqual([
      "Export Timestamp",
      "Export Schema Version",
      "Extension Version",
      "Active Profile",
      "Export Type",
      "Basecamp Scraped At",
      "EasySpeak Scraped At",
      "Basecamp Clubs",
      "Basecamp Members",
      "EasySpeak Clubs",
      "EasySpeak Members",
      "Club Pairs",
      "Members Matched",
      "Members Total",
    ]);
  });

  it("falls back to 'Not yet extracted' when a scrape timestamp is missing", () => {
    const rows = buildMetadataRows({
      exportedAt: 1700000200000,
      extensionVersion: "0.6.1",
      schemaVersion: "1",
      activeProfileLabel: "Demo",
      exportType: "all",
      basecampScrapedAt: null,
      easyspeakScrapedAt: null,
      basecampData,
      easyspeakData,
      report,
    });
    expect(rows.find((r) => r.key === "Basecamp Scraped At")!.value).toBe("Not yet extracted");
    expect(rows.find((r) => r.key === "EasySpeak Scraped At")!.value).toBe("Not yet extracted");
  });

  it("counts reuse the same functions the rest of the app uses, not a re-derived count", () => {
    const rows = buildMetadataRows({
      exportedAt: 1700000200000,
      extensionVersion: "0.6.1",
      schemaVersion: "1",
      activeProfileLabel: "Demo",
      exportType: "all",
      basecampScrapedAt: 1700000000000,
      easyspeakScrapedAt: 1700000100000,
      basecampData,
      easyspeakData,
      report,
    });
    const { matched, total } = computeMatchSummary(report);
    expect(rows.find((r) => r.key === "Basecamp Members")!.value).toBe(countBasecampMembers(basecampData));
    expect(rows.find((r) => r.key === "EasySpeak Members")!.value).toBe(countEasySpeakMembers(easyspeakData));
    expect(rows.find((r) => r.key === "Members Matched")!.value).toBe(matched);
    expect(rows.find((r) => r.key === "Members Total")!.value).toBe(total);
  });

  it("labels the export type row for each ExportType", () => {
    const base = {
      exportedAt: 1700000200000,
      extensionVersion: "0.6.1",
      schemaVersion: "1",
      activeProfileLabel: "Demo",
      basecampScrapedAt: 1700000000000,
      easyspeakScrapedAt: 1700000100000,
      basecampData,
      easyspeakData,
      report,
    };
    expect(buildMetadataRows({ ...base, exportType: "all" }).find((r) => r.key === "Export Type")!.value).toBe("All data");
    expect(buildMetadataRows({ ...base, exportType: "basecamp" }).find((r) => r.key === "Export Type")!.value).toBe("Basecamp");
    expect(buildMetadataRows({ ...base, exportType: "easyspeak" }).find((r) => r.key === "Export Type")!.value).toBe("EasySpeak");
  });
});

// ---------------------------------------------------------------------------
// buildExportSheets — thin integration check
// ---------------------------------------------------------------------------

describe("buildExportSheets", () => {
  const report = buildReport(basecampData, easyspeakData, { basecampScrapedAt: 1700000000000, easyspeakScrapedAt: 1700000100000 });
  const resolution = emptyResolution();
  const metadata = {
    exportedAt: 1700000200000,
    extensionVersion: "0.6.1",
    schemaVersion: "1",
    activeProfileLabel: "Demo",
    basecampScrapedAt: 1700000000000,
    easyspeakScrapedAt: 1700000100000,
  };

  it("'all' combines all 5 builders into one object, consistent with calling each directly", () => {
    const sheets = buildExportSheets({ exportType: "all", basecampData, easyspeakData, report, resolution, metadata });

    expect(Object.keys(sheets).sort()).toEqual(["aggregated", "basecamp", "easyspeak", "matches", "metadata"]);
    expect(sheets.aggregated).toEqual(buildAggregatedRows(report));
    expect(sheets.matches).toEqual(buildMatchesRows(report, resolution));
    expect(sheets.basecamp).toEqual(buildBasecampRows(basecampData));
    expect(sheets.easyspeak).toEqual(buildEasySpeakRows(easyspeakData));
  });

  it("'basecamp' includes only the Basecamp and Metadata sheets", () => {
    const sheets = buildExportSheets({ exportType: "basecamp", basecampData, easyspeakData, report, resolution, metadata });

    expect(Object.keys(sheets).sort()).toEqual(["basecamp", "metadata"]);
    expect(sheets.basecamp).toEqual(buildBasecampRows(basecampData));
    expect(sheets.aggregated).toBeUndefined();
    expect(sheets.matches).toBeUndefined();
    expect(sheets.easyspeak).toBeUndefined();
  });

  it("'easyspeak' includes only the EasySpeak and Metadata sheets", () => {
    const sheets = buildExportSheets({ exportType: "easyspeak", basecampData, easyspeakData, report, resolution, metadata });

    expect(Object.keys(sheets).sort()).toEqual(["easyspeak", "metadata"]);
    expect(sheets.easyspeak).toEqual(buildEasySpeakRows(easyspeakData));
    expect(sheets.aggregated).toBeUndefined();
    expect(sheets.matches).toBeUndefined();
    expect(sheets.basecamp).toBeUndefined();
  });
});
