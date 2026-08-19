// src/shared/export/rows.ts
//
// Pure sheet-row shaping for the "Export to Excel" feature — no exceljs
// import, no browser.* dependency, so this is Vitest-testable the same way
// shared/sync/delta.ts is (see tests/export.test.ts). Consumes buildReport()'s
// ReportResult and resolution-store.ts's persisted records directly — no
// matching/aggregation logic is reimplemented here.

import { computeLevelSummary, computeMatchSummary, countBasecampMembers, countEasySpeakMembers } from "../sync/delta";
import type {
  BasecampProgression,
  BasecampScrape,
  EasySpeakLevel,
  EasySpeakScrape,
  LevelDiff,
  LevelUpStatus,
  MatchConfidence,
  MatchSource,
  MemberReport,
  Presence,
  ReportResult,
  ResolutionData,
} from "../types";

// Pathways always has exactly 5 levels (see PATHWAYS_LEVEL_COUNT in
// shared/sync/conflicts.ts) — flattening level-by-level data into fixed
// columns is safe, not "variable-length".
const LEVEL_NUMBERS = [1, 2, 3, 4, 5] as const;

// Which sheets buildExportSheets() includes — see that function below. The
// label is shared between the Metadata sheet's "Export Type" row and the
// Sync Data page's selector, so it only lives in one place.
export type ExportType = "all" | "basecamp" | "easyspeak";

export const EXPORT_TYPE_LABEL: Record<ExportType, string> = {
  all: "All data",
  basecamp: "Basecamp",
  easyspeak: "EasySpeak",
};

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

// ---------------------------------------------------------------------------
// Aggregated sheet
// ---------------------------------------------------------------------------

type AggregatedLevelSuffix = "EasyspeakNeeded" | "EasyspeakDone" | "BasecampCompleted" | "BasecampTotal" | "BasecampApproved" | "Discrepancy" | "PendingValidation";

type AggregatedLevelColumns = {
  [K in `level${(typeof LEVEL_NUMBERS)[number]}${AggregatedLevelSuffix}`]: number | boolean | null;
};

interface AggregatedRowBase {
  basecampClubName: string | null;
  easyspeakClubName: string | null;
  clubMatchScore: number | null;
  clubMatchForced: boolean;
  basecampUserId: number | null;
  easyspeakMemberId: string | null;
  memberName: string;
  basecampName: string | null;
  easyspeakName: string | null;
  memberPresence: Presence;
  matchConfidence: MatchConfidence;
  matchScore: number | null;
  matchSource: MatchSource;
  easyspeakNoActivePath: boolean;
  pathCanonicalKey: string | null;
  pathDisplayName: string | null;
  basecampPathName: string | null;
  easyspeakPathLabel: string | null;
  pathPresence: Presence | null;
  nonPathway: boolean | null;
  pathOverridden: boolean | null;
  pathOrphaned: boolean | null;
  pathFlagged: boolean | null;
  easyspeakCompletedHistory: boolean | null;
  manuallyCompleted: boolean | null;
  currentLevel: number | null;
  currentLevelLabel: string | null;
  nextLevelLabel: string | null;
  status: LevelUpStatus | null;
  statusDetail: string | null;
  theoreticalMissing: number | null;
  unreportedInBasecamp: number | null;
  realMissing: number | null;
  pathCompletionCompleted: number | null;
  pathCompletionTotal: number | null;
  pathCompletionMissing: number | null;
}

export type AggregatedRow = AggregatedRowBase & AggregatedLevelColumns;

function flattenLevelDiffs(levels: LevelDiff[]): AggregatedLevelColumns {
  const out = {} as AggregatedLevelColumns;
  for (const n of LEVEL_NUMBERS) {
    const level = levels.find((l) => l.level === n) ?? null;
    out[`level${n}EasyspeakNeeded`] = level?.easyspeak?.needed ?? null;
    out[`level${n}EasyspeakDone`] = level?.easyspeak?.done ?? null;
    out[`level${n}BasecampCompleted`] = level?.basecamp?.completed ?? null;
    out[`level${n}BasecampTotal`] = level?.basecamp?.total ?? null;
    out[`level${n}BasecampApproved`] = level?.basecamp?.approved ?? null;
    out[`level${n}Discrepancy`] = level?.discrepancy ?? null;
    out[`level${n}PendingValidation`] = level?.pendingValidation ?? null;
  }
  return out;
}

/**
 * One row per member×path — deliberately NOT filtered the way
 * buildLevelSummary() filters (that function skips nonPathway/
 * completedHistory/manuallyCompleted paths for the Club Progress UI; this
 * sheet keeps every path, per "full data over minimal data"). A member with
 * no paths at all still emits exactly one row, with every path-scoped
 * column blank — defensive, shouldn't happen in practice.
 *
 * computeLevelSummary() assumes a populated `path.levels[]`, which is `[]` by
 * construction for a nonPathway path (see matchPaths() in
 * shared/sync/conflicts.ts) — indexing into an empty levels[] there throws,
 * so it's only called when `!path.nonPathway`.
 */
export function buildAggregatedRows(report: ReportResult): AggregatedRow[] {
  const rows: AggregatedRow[] = [];
  for (const club of report.clubPairs) {
    for (const member of club.members) {
      const paths = member.paths.length > 0 ? member.paths : [null];
      for (const path of paths) {
        const summary = path && !path.nonPathway ? computeLevelSummary(path) : null;
        rows.push({
          basecampClubName: club.basecampClubName,
          easyspeakClubName: club.easyspeakClubName,
          clubMatchScore: club.matchScore,
          clubMatchForced: club.clubMatchForced,
          basecampUserId: member.basecampUserId,
          easyspeakMemberId: member.easyspeakMemberId,
          memberName: member.name,
          basecampName: member.basecampName,
          easyspeakName: member.easyspeakName,
          memberPresence: member.presence,
          matchConfidence: member.matchConfidence,
          matchScore: member.matchScore,
          matchSource: member.matchSource,
          easyspeakNoActivePath: member.easyspeakNoActivePath,
          pathCanonicalKey: path?.canonicalKey ?? null,
          pathDisplayName: path?.displayName ?? null,
          basecampPathName: path?.basecampPathName ?? null,
          easyspeakPathLabel: path?.easyspeakPathLabel ?? null,
          pathPresence: path?.presence ?? null,
          nonPathway: path?.nonPathway ?? null,
          pathOverridden: path?.overridden ?? null,
          pathOrphaned: path?.orphaned ?? null,
          pathFlagged: path?.flagged ?? null,
          easyspeakCompletedHistory: path?.completedHistory ?? null,
          manuallyCompleted: path?.manuallyCompleted ?? null,
          currentLevel: summary?.currentLevel ?? null,
          currentLevelLabel: summary?.currentLevelLabel ?? null,
          nextLevelLabel: summary?.nextLevelLabel ?? null,
          status: summary?.status ?? null,
          statusDetail: summary?.statusDetail ?? null,
          theoreticalMissing: summary?.theoreticalMissing ?? null,
          unreportedInBasecamp: summary?.unreportedInBasecamp ?? null,
          realMissing: summary?.realMissing ?? null,
          ...flattenLevelDiffs(path?.levels ?? []),
          pathCompletionCompleted: path?.pathCompletion?.completed ?? null,
          pathCompletionTotal: path?.pathCompletion?.total ?? null,
          pathCompletionMissing: path?.pathCompletion?.missing ?? null,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Matches & Resolutions sheet
// ---------------------------------------------------------------------------

export type MatchRecordType =
  | "Club Match"
  | "Member Match"
  | "Rejected Member Pair"
  | "Rejected Club Pair"
  | "Member Orphan"
  | "Path Override"
  | "Path Exclusion"
  | "Path Orphan"
  | "Path Flag"
  | "Path Completion";

export interface MatchesRow {
  recordType: MatchRecordType;
  basecampClubId: string | null;
  basecampClubName: string | null;
  easyspeakClubId: string | null;
  easyspeakClubName: string | null;
  basecampUserId: number | null;
  easyspeakMemberId: string | null;
  basecampName: string | null;
  easyspeakName: string | null;
  basecampPathName: string | null;
  easyspeakPathLabel: string | null;
  presence: Presence | null;
  matchConfidence: MatchConfidence;
  matchScore: number | null;
  matchSource: MatchSource;
  forced: boolean | null;
  recordedAt: string | null;
  notes: string;
}

/** Structurally identical to loadResolutionData()'s return shape (minus
 *  pathAliasLookup, which no export row needs) — declared locally so this
 *  file never imports shared/resolution-store.ts (browser.*-dependent). */
export type ResolutionRecords = Required<Omit<ResolutionData, "allowFuzzyMemberMatches" | "pathAliasLookup">>;

function describeMemberMatchNotes(member: MemberReport): string {
  if (member.presence !== "both") {
    const side = member.presence === "basecamp-only" ? "Basecamp" : "EasySpeak";
    return member.matchSource === "orphan" ? `Marked orphan: ${side} only` : `One-sided: ${side} only`;
  }
  switch (member.matchConfidence) {
    case "exact":
      return "Automatic (exact name match)";
    case "fuzzy":
      return "Suggested match (unconfirmed)";
    case "confirmed":
      return member.matchSource === "manual-search" ? "Linked via manual search" : "Confirmed from a suggested match";
    default:
      return "";
  }
}

function memberIdFields(basecampUserId: number, easyspeakMemberId: string) {
  return {
    basecampClubId: null,
    basecampClubName: null,
    easyspeakClubId: null,
    easyspeakClubName: null,
    basecampUserId,
    easyspeakMemberId,
    basecampName: null,
    easyspeakName: null,
  } as const;
}

/**
 * One flat table (not stacked mini-tables), discriminated by `recordType` —
 * covers every one of loadResolutionData()'s 10 stored record kinds, plus the
 * two *live* match results ("Club Match"/"Member Match", read off `report`
 * itself rather than duplicated from clubLookup/memberLinks, since a
 * pin/confirmed link is already reflected there via clubMatchForced/
 * matchConfidence — best-effort cross-referenced back to the stored record
 * only to recover a timestamp for "Recorded At").
 */
export function buildMatchesRows(report: ReportResult, resolution: ResolutionRecords): MatchesRow[] {
  const rows: MatchesRow[] = [];

  const clubLookupByPair = new Map(resolution.clubLookup.map((c) => [`${c.basecampClubId}::${c.easyspeakClubId}`, c]));
  const memberLinksByPair = new Map(resolution.memberLinks.map((l) => [`${l.basecampUserId}::${l.easyspeakMemberId}`, l]));

  for (const club of report.clubPairs) {
    if (club.basecampClubId && club.easyspeakClubId) {
      const pin = clubLookupByPair.get(`${club.basecampClubId}::${club.easyspeakClubId}`);
      rows.push({
        recordType: "Club Match",
        basecampClubId: club.basecampClubId,
        basecampClubName: club.basecampClubName,
        easyspeakClubId: club.easyspeakClubId,
        easyspeakClubName: club.easyspeakClubName,
        basecampUserId: null,
        easyspeakMemberId: null,
        basecampName: null,
        easyspeakName: null,
        basecampPathName: null,
        easyspeakPathLabel: null,
        presence: null,
        matchConfidence: null,
        matchScore: club.matchScore,
        matchSource: pin?.source ?? null,
        forced: club.clubMatchForced,
        recordedAt: null, // ClubLookupEntry has no timestamp field
        notes: club.clubMatchForced ? "Pinned club match" : club.matchScore === 1 ? "Automatic (exact name match)" : "Automatic",
      });
    }

    for (const member of club.members) {
      const link =
        member.basecampUserId != null && member.easyspeakMemberId != null
          ? memberLinksByPair.get(`${member.basecampUserId}::${member.easyspeakMemberId}`)
          : undefined;
      rows.push({
        recordType: "Member Match",
        basecampClubId: club.basecampClubId,
        basecampClubName: club.basecampClubName,
        easyspeakClubId: club.easyspeakClubId,
        easyspeakClubName: club.easyspeakClubName,
        basecampUserId: member.basecampUserId,
        easyspeakMemberId: member.easyspeakMemberId,
        basecampName: member.basecampName,
        easyspeakName: member.easyspeakName,
        basecampPathName: null,
        easyspeakPathLabel: null,
        presence: member.presence,
        matchConfidence: member.matchConfidence,
        matchScore: member.matchScore,
        matchSource: member.matchSource,
        forced: member.matchConfidence === "confirmed",
        recordedAt: link ? formatTimestamp(link.confirmedAt) : null,
        notes: describeMemberMatchNotes(member),
      });
    }
  }

  for (const r of resolution.rejectedPairs) {
    rows.push({
      recordType: "Rejected Member Pair",
      ...memberIdFields(r.basecampUserId, r.easyspeakMemberId),
      basecampPathName: null,
      easyspeakPathLabel: null,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(r.rejectedAt),
      notes: "",
    });
  }

  for (const r of resolution.clubRejectedPairs) {
    rows.push({
      recordType: "Rejected Club Pair",
      basecampClubId: r.basecampClubId,
      basecampClubName: null,
      easyspeakClubId: r.easyspeakClubId,
      easyspeakClubName: null,
      basecampUserId: null,
      easyspeakMemberId: null,
      basecampName: null,
      easyspeakName: null,
      basecampPathName: null,
      easyspeakPathLabel: null,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(r.rejectedAt),
      notes: "",
    });
  }

  for (const o of resolution.memberOrphans) {
    rows.push({
      recordType: "Member Orphan",
      basecampClubId: null,
      basecampClubName: null,
      easyspeakClubId: null,
      easyspeakClubName: null,
      basecampUserId: o.basecampUserId,
      easyspeakMemberId: o.easyspeakMemberId,
      basecampName: null,
      easyspeakName: null,
      basecampPathName: null,
      easyspeakPathLabel: null,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(o.orphanedAt),
      notes: o.basecampUserId != null ? "One-sided: Basecamp only" : "One-sided: EasySpeak only",
    });
  }

  for (const o of resolution.memberPathOverrides) {
    rows.push({
      recordType: "Path Override",
      ...memberIdFields(o.basecampUserId, o.easyspeakMemberId),
      basecampPathName: o.basecampPathName,
      easyspeakPathLabel: o.easyspeakPathLabel,
      presence: "both",
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: true,
      recordedAt: formatTimestamp(o.boundAt),
      notes: "Manually bound for this member",
    });
  }

  for (const e of resolution.memberPathExclusions) {
    rows.push({
      recordType: "Path Exclusion",
      ...memberIdFields(e.basecampUserId, e.easyspeakMemberId),
      basecampPathName: e.basecampPathName,
      easyspeakPathLabel: e.easyspeakPathLabel,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(e.excludedAt),
      notes: "Automatic pairing force-unbound for this member",
    });
  }

  for (const o of resolution.memberPathOrphans) {
    rows.push({
      recordType: "Path Orphan",
      ...memberIdFields(o.basecampUserId, o.easyspeakMemberId),
      basecampPathName: o.basecampPathName,
      easyspeakPathLabel: o.easyspeakPathLabel,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(o.orphanedAt),
      notes: o.basecampPathName != null ? "One-sided: Basecamp only" : "One-sided: EasySpeak only",
    });
  }

  for (const f of resolution.memberPathFlags) {
    rows.push({
      recordType: "Path Flag",
      ...memberIdFields(f.basecampUserId, f.easyspeakMemberId),
      basecampPathName: f.basecampPathName,
      easyspeakPathLabel: f.easyspeakPathLabel,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(f.flaggedAt),
      notes: "Reviewed, deliberately deferred (neither bound nor marked orphan)",
    });
  }

  for (const c of resolution.memberPathCompletions) {
    rows.push({
      recordType: "Path Completion",
      ...memberIdFields(c.basecampUserId, c.easyspeakMemberId),
      basecampPathName: null,
      easyspeakPathLabel: c.easyspeakPathLabel,
      presence: null,
      matchConfidence: null,
      matchScore: null,
      matchSource: null,
      forced: null,
      recordedAt: formatTimestamp(c.completedAt),
      notes: "Manually marked completed (EasySpeak-only path)",
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Basecamp sheet — one row per stored BasecampMember, raw/unaggregated
// ---------------------------------------------------------------------------

type BasecampLevelSuffix = "Completed" | "Total" | "Approved";

type BasecampLevelColumns = {
  [K in `level${(typeof LEVEL_NUMBERS)[number]}${BasecampLevelSuffix}`]: number | boolean | null;
};

export interface BasecampRawRow extends BasecampLevelColumns {
  clubId: string;
  clubName: string;
  basecampUserId: number;
  basecampName: string;
  pathName: string;
  pathCompletionCompleted: number | null;
  pathCompletionTotal: number | null;
  rawRecordJson: string;
}

function flattenBasecampProgression(progression: BasecampProgression): BasecampLevelColumns {
  const out = {} as BasecampLevelColumns;
  for (const n of LEVEL_NUMBERS) {
    const entry = progression[`Level ${n}`];
    out[`level${n}Completed`] = entry?.completed ?? null;
    out[`level${n}Total`] = entry?.total ?? null;
    out[`level${n}Approved`] = entry?.approved ?? null;
  }
  return out;
}

/** One row per club×member×path exactly as stored — not deduped by user id
 *  (that's what the Aggregated sheet is for); this sheet is the raw scrape. */
export function buildBasecampRows(basecampData: BasecampScrape): BasecampRawRow[] {
  const rows: BasecampRawRow[] = [];
  for (const [clubId, club] of Object.entries(basecampData)) {
    for (const member of club.members) {
      const completion = member.progression["Path Completion"];
      rows.push({
        clubId,
        clubName: club.name,
        basecampUserId: member.user.id,
        basecampName: member.user.name,
        pathName: member.path_name,
        ...flattenBasecampProgression(member.progression),
        pathCompletionCompleted: completion?.completed ?? null,
        pathCompletionTotal: completion?.total ?? null,
        rawRecordJson: JSON.stringify(member),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// EasySpeak sheet — one row per EasySpeakMemberRow, raw/unaggregated
// ---------------------------------------------------------------------------

type EasySpeakLevelColumns = {
  [K in `level${(typeof LEVEL_NUMBERS)[number]}${"Needed" | "Done"}`]: number | null;
};

export interface EasySpeakRawRow extends EasySpeakLevelColumns {
  clubId: string;
  clubName: string;
  easyspeakMemberId: string | null;
  name: string;
  path: string;
  rawLevelsJson: string;
}

function flattenEasySpeakLevels(levels: EasySpeakLevel[]): EasySpeakLevelColumns {
  const out = {} as EasySpeakLevelColumns;
  for (const n of LEVEL_NUMBERS) {
    const level = levels.find((l) => l.level === n) ?? null;
    out[`level${n}Needed`] = level?.needed ?? null;
    out[`level${n}Done`] = level?.done ?? null;
  }
  return out;
}

export function buildEasySpeakRows(easyspeakData: EasySpeakScrape): EasySpeakRawRow[] {
  const rows: EasySpeakRawRow[] = [];
  for (const [clubId, club] of Object.entries(easyspeakData)) {
    for (const member of club.members) {
      rows.push({
        clubId,
        clubName: club.name,
        easyspeakMemberId: member.memberId,
        name: member.name,
        path: member.path,
        ...flattenEasySpeakLevels(member.levels),
        rawLevelsJson: JSON.stringify(member.levels),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Metadata sheet
// ---------------------------------------------------------------------------

export interface MetadataRow {
  key: string;
  value: string | number;
}

export interface MetadataInput {
  exportedAt: number;
  extensionVersion: string;
  schemaVersion: string;
  activeProfileLabel: string;
  exportType: ExportType;
  basecampScrapedAt: number | null;
  easyspeakScrapedAt: number | null;
  basecampData: BasecampScrape;
  easyspeakData: EasySpeakScrape;
  report: ReportResult;
}

export function buildMetadataRows(input: MetadataInput): MetadataRow[] {
  const { matched, total } = computeMatchSummary(input.report);
  return [
    { key: "Export Timestamp", value: new Date(input.exportedAt).toLocaleString() },
    { key: "Export Schema Version", value: input.schemaVersion },
    { key: "Extension Version", value: input.extensionVersion },
    { key: "Active Profile", value: input.activeProfileLabel },
    { key: "Export Type", value: EXPORT_TYPE_LABEL[input.exportType] },
    {
      key: "Basecamp Scraped At",
      value: input.basecampScrapedAt ? new Date(input.basecampScrapedAt).toLocaleDateString() : "Not yet extracted",
    },
    {
      key: "EasySpeak Scraped At",
      value: input.easyspeakScrapedAt ? new Date(input.easyspeakScrapedAt).toLocaleDateString() : "Not yet extracted",
    },
    { key: "Basecamp Clubs", value: Object.keys(input.basecampData).length },
    { key: "Basecamp Members", value: countBasecampMembers(input.basecampData) },
    { key: "EasySpeak Clubs", value: Object.keys(input.easyspeakData).length },
    { key: "EasySpeak Members", value: countEasySpeakMembers(input.easyspeakData) },
    { key: "Club Pairs", value: input.report.clubPairs.length },
    { key: "Members Matched", value: matched },
    { key: "Members Total", value: total },
  ];
}

// ---------------------------------------------------------------------------
// Orchestration — combines all 5 builders into the shape workbook.ts consumes
// ---------------------------------------------------------------------------

export interface ExportSheets {
  aggregated?: AggregatedRow[];
  matches?: MatchesRow[];
  basecamp?: BasecampRawRow[];
  easyspeak?: EasySpeakRawRow[];
  metadata: MetadataRow[];
}

export interface ExportInputs {
  exportType: ExportType;
  basecampData: BasecampScrape;
  easyspeakData: EasySpeakScrape;
  report: ReportResult;
  resolution: ResolutionRecords;
  metadata: Omit<MetadataInput, "basecampData" | "easyspeakData" | "report" | "exportType">;
}

export function buildExportSheets(inputs: ExportInputs): ExportSheets {
  const sheets: ExportSheets = {
    metadata: buildMetadataRows({
      ...inputs.metadata,
      exportType: inputs.exportType,
      basecampData: inputs.basecampData,
      easyspeakData: inputs.easyspeakData,
      report: inputs.report,
    }),
  };

  if (inputs.exportType === "all") {
    sheets.aggregated = buildAggregatedRows(inputs.report);
    sheets.matches = buildMatchesRows(inputs.report, inputs.resolution);
  }
  if (inputs.exportType === "all" || inputs.exportType === "basecamp") {
    sheets.basecamp = buildBasecampRows(inputs.basecampData);
  }
  if (inputs.exportType === "all" || inputs.exportType === "easyspeak") {
    sheets.easyspeak = buildEasySpeakRows(inputs.easyspeakData);
  }

  return sheets;
}
