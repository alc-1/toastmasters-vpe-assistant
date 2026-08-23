// src/shared/export/workbook.ts
//
// The only file in shared/export/ that imports exceljs — turns the plain row
// arrays shaped by rows.ts into an actual ExcelJS.Workbook (headers, column
// widths, freeze pane, autofilter). No browser.* dependency, so this could in
// principle run under Vitest's default Node environment (only exceljs's
// file/streaming APIs touch `fs`, and this module never calls them).

import ExcelJS from "exceljs";
import type { AggregatedRow, BasecampRawRow, EasySpeakRawRow, ExportSheets, MatchesRow, MetadataRow } from "./rows";

type ColumnSpec<T> = { header: string; key: keyof T & string; width?: number };

function addSheet<T extends object>(workbook: ExcelJS.Workbook, name: string, columns: ColumnSpec<T>[], rows: T[]): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  if (columns.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
}

function levelColumns<T extends object>(prefix: "level", suffixes: string[], width = 10): ColumnSpec<T>[] {
  const columns: ColumnSpec<T>[] = [];
  for (const n of [1, 2, 3, 4, 5]) {
    for (const suffix of suffixes) {
      const label = suffix.replace(/([A-Z])/g, " $1").trim().replace("Easyspeak", "EasySpeak");
      columns.push({ header: `Level ${n} ${label}`, key: `${prefix}${n}${suffix}` as keyof T & string, width });
    }
  }
  return columns;
}

const AGGREGATED_COLUMNS: ColumnSpec<AggregatedRow>[] = [
  { header: "Basecamp Club Name", key: "basecampClubName", width: 26 },
  { header: "EasySpeak Club Name", key: "easyspeakClubName", width: 26 },
  { header: "Club Match Score", key: "clubMatchScore", width: 12 },
  { header: "Club Match Forced", key: "clubMatchForced", width: 12 },
  { header: "Basecamp Member ID", key: "basecampUserId", width: 16 },
  { header: "EasySpeak Member ID", key: "easyspeakMemberId", width: 16 },
  { header: "Member Name", key: "memberName", width: 26 },
  { header: "Basecamp Name", key: "basecampName", width: 24 },
  { header: "EasySpeak Name", key: "easyspeakName", width: 24 },
  { header: "Member Presence", key: "memberPresence", width: 16 },
  { header: "Match Confidence", key: "matchConfidence", width: 14 },
  { header: "Match Score", key: "matchScore", width: 12 },
  { header: "Match Source", key: "matchSource", width: 16 },
  { header: "EasySpeak No Active Path", key: "easyspeakNoActivePath", width: 16 },
  { header: "Path Canonical Key", key: "pathCanonicalKey", width: 24 },
  { header: "Path Display Name", key: "pathDisplayName", width: 26 },
  { header: "Basecamp Path Name", key: "basecampPathName", width: 26 },
  { header: "EasySpeak Path Label", key: "easyspeakPathLabel", width: 26 },
  { header: "Path Presence", key: "pathPresence", width: 16 },
  { header: "Non-Pathway", key: "nonPathway", width: 12 },
  { header: "Path Overridden", key: "pathOverridden", width: 12 },
  { header: "Path Orphaned", key: "pathOrphaned", width: 12 },
  { header: "Path Flagged", key: "pathFlagged", width: 12 },
  { header: "Manually Completed", key: "manuallyCompleted", width: 14 },
  { header: "Basecamp Confirmed Completed", key: "basecampConfirmedCompleted", width: 18 },
  { header: "Basecamp Completed Path Name", key: "basecampCompletedName", width: 26 },
  { header: "Current Level", key: "currentLevel", width: 12 },
  { header: "Current Level Label", key: "currentLevelLabel", width: 18 },
  { header: "Next Level Label", key: "nextLevelLabel", width: 16 },
  { header: "Status", key: "status", width: 18 },
  { header: "Status Detail", key: "statusDetail", width: 36 },
  { header: "Theoretical Missing", key: "theoreticalMissing", width: 14 },
  { header: "Unreported In Basecamp", key: "unreportedInBasecamp", width: 16 },
  { header: "Real Missing", key: "realMissing", width: 12 },
  ...levelColumns<AggregatedRow>("level", ["EasyspeakNeeded", "EasyspeakDone", "BasecampCompleted", "BasecampTotal", "BasecampApproved", "Discrepancy", "PendingValidation"]),
  { header: "Path Completion Completed", key: "pathCompletionCompleted", width: 14 },
  { header: "Path Completion Total", key: "pathCompletionTotal", width: 14 },
  { header: "Path Completion Missing", key: "pathCompletionMissing", width: 14 },
];

const MATCHES_COLUMNS: ColumnSpec<MatchesRow>[] = [
  { header: "Record Type", key: "recordType", width: 20 },
  { header: "Basecamp Club ID", key: "basecampClubId", width: 18 },
  { header: "Basecamp Club Name", key: "basecampClubName", width: 26 },
  { header: "EasySpeak Club ID", key: "easyspeakClubId", width: 18 },
  { header: "EasySpeak Club Name", key: "easyspeakClubName", width: 26 },
  { header: "Basecamp Member ID", key: "basecampUserId", width: 16 },
  { header: "EasySpeak Member ID", key: "easyspeakMemberId", width: 16 },
  { header: "Basecamp Name", key: "basecampName", width: 24 },
  { header: "EasySpeak Name", key: "easyspeakName", width: 24 },
  { header: "Basecamp Path Name", key: "basecampPathName", width: 26 },
  { header: "EasySpeak Path Label", key: "easyspeakPathLabel", width: 26 },
  { header: "Presence", key: "presence", width: 16 },
  { header: "Match Confidence", key: "matchConfidence", width: 14 },
  { header: "Match Score", key: "matchScore", width: 12 },
  { header: "Match Source", key: "matchSource", width: 16 },
  { header: "Forced / Pinned", key: "forced", width: 12 },
  { header: "Recorded At", key: "recordedAt", width: 20 },
  { header: "Notes", key: "notes", width: 40 },
];

const BASECAMP_COLUMNS: ColumnSpec<BasecampRawRow>[] = [
  { header: "Club ID", key: "clubId", width: 18 },
  { header: "Club Name", key: "clubName", width: 26 },
  { header: "Basecamp User ID", key: "basecampUserId", width: 16 },
  { header: "Basecamp Name", key: "basecampName", width: 24 },
  { header: "Path Name", key: "pathName", width: 26 },
  ...levelColumns<BasecampRawRow>("level", ["Completed", "Total", "Approved"]),
  { header: "Path Completion Completed", key: "pathCompletionCompleted", width: 14 },
  { header: "Path Completion Total", key: "pathCompletionTotal", width: 14 },
  { header: "Raw Record JSON", key: "rawRecordJson", width: 60 },
];

const EASYSPEAK_COLUMNS: ColumnSpec<EasySpeakRawRow>[] = [
  { header: "Club ID", key: "clubId", width: 12 },
  { header: "Club Name", key: "clubName", width: 26 },
  { header: "EasySpeak Member ID", key: "easyspeakMemberId", width: 16 },
  { header: "Name", key: "name", width: 24 },
  { header: "Path", key: "path", width: 26 },
  ...levelColumns<EasySpeakRawRow>("level", ["Needed", "Done"]),
  { header: "Raw Levels JSON", key: "rawLevelsJson", width: 60 },
];

const METADATA_COLUMNS: ColumnSpec<MetadataRow>[] = [
  { header: "Key", key: "key", width: 26 },
  { header: "Value", key: "value", width: 40 },
];

export function buildExportWorkbook(sheets: ExportSheets): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Toastmasters VPE Assistant";
  workbook.created = new Date();

  if (sheets.aggregated) addSheet(workbook, "Aggregated", AGGREGATED_COLUMNS, sheets.aggregated);
  if (sheets.matches) addSheet(workbook, "Matches & Resolutions", MATCHES_COLUMNS, sheets.matches);
  if (sheets.basecamp) addSheet(workbook, "Basecamp", BASECAMP_COLUMNS, sheets.basecamp);
  if (sheets.easyspeak) addSheet(workbook, "EasySpeak", EASYSPEAK_COLUMNS, sheets.easyspeak);
  addSheet(workbook, "Metadata", METADATA_COLUMNS, sheets.metadata);

  return workbook;
}
