// src/shared/export/export-to-excel.ts
//
// browser.*-dependent orchestrator: reads storage + resolution-store, calls
// buildReport() (no matching/aggregation logic is reimplemented here), then
// chains rows.ts -> workbook.ts -> download.ts. Plain synchronous client-side
// work triggered directly from a page's click handler — no sendMessage/
// background round trip, same reasoning already applied to Member Review's
// direct resolution-store writes (no browser.tabs/background-lifetime
// constraint applies here, unlike EasySpeak's tab-navigation).

import { local } from "../storage";
import { loadResolutionData } from "../resolution-store";
import { getActiveProfile, EASYSPEAK_SERVERS } from "../settings-store";
import { buildReport } from "../sync/delta";
import { buildExportSheets } from "./rows";
import { buildExportWorkbook } from "./workbook";
import { downloadBlob } from "./download";
import type { ProfileId } from "../types";

export const EXPORT_SCHEMA_VERSION = "1";

export function buildExportFilename(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `toastmasters-export-${iso}.xlsx`;
}

export interface ExportSummary {
  filename: string;
  hasBasecampData: boolean;
  hasEasySpeakData: boolean;
  memberRowCount: number;
}

function formatProfileLabel(profileId: ProfileId | null): string {
  if (!profileId) return "No profile selected";
  if (profileId === "demo") return "Demo";
  return EASYSPEAK_SERVERS.find((s) => s.id === profileId)?.label ?? profileId;
}

/**
 * Never gates on data being present — a partial (one-sided or even empty)
 * export is still legitimate; buildReport() already tolerates an empty
 * scrape object the same way it does for a not-yet-imported source anywhere
 * else in the app.
 */
export async function exportToExcel(): Promise<ExportSummary> {
  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);
  const basecampData = cached.basecampData ?? {};
  const easyspeakData = cached.easyspeakData ?? {};

  const resolution = await loadResolutionData();
  const report = buildReport(
    basecampData,
    easyspeakData,
    { basecampScrapedAt: cached.basecampScrapedAt, easyspeakScrapedAt: cached.easyspeakScrapedAt },
    resolution
  );

  const activeProfile = await getActiveProfile();
  const extensionVersion = browser.runtime.getManifest().version;

  const sheets = buildExportSheets({
    basecampData,
    easyspeakData,
    report,
    resolution,
    metadata: {
      exportedAt: Date.now(),
      extensionVersion,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      activeProfileLabel: formatProfileLabel(activeProfile),
      basecampScrapedAt: cached.basecampScrapedAt ?? null,
      easyspeakScrapedAt: cached.easyspeakScrapedAt ?? null,
    },
  });

  const workbook = buildExportWorkbook(sheets);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filename = buildExportFilename();
  await downloadBlob(blob, filename);

  return {
    filename,
    hasBasecampData: !!cached.basecampData,
    hasEasySpeakData: !!cached.easyspeakData,
    memberRowCount: sheets.aggregated.length,
  };
}
