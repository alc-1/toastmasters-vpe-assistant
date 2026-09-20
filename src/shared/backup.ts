// src/shared/backup.ts
//
// "Save Backup File" / "Load Backup File" on the Home dashboard
// (entrypoints/app/views/dashboard.ts). Browser-dependent orchestrator —
// same category as shared/export/export-to-excel.ts (storage + DOM download,
// no pure logic worth isolating in the parts that touch browser.*). The
// pure parts (parseBackup, backupFilename) ARE unit-tested — see
// tests/backup.test.ts.
//
// A backup is the raw whole storage.local area (shared/storage.ts's
// local.dumpAll()), so it round-trips every profile's data + all settings +
// every persisted match/resolution decision. Restore is a full replace
// (local.replaceAll()), so the dashboard confirms with the user first.

import { downloadBlob } from "./export/download";
import { t } from "./i18n-pure";
import { local } from "./storage";

export const BACKUP_FORMAT = "toastmasters-vpe-assistant-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  extensionVersion: string;
  /** Raw storage.local dump — see shared/storage.ts's local.dumpAll(). */
  data: Record<string, unknown>;
}

/** PURE. `toastmasters-vpe-assistant-backup-YYYY-MM-DD.json`. */
export function backupFilename(now: Date = new Date()): string {
  return `${BACKUP_FORMAT}-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * PURE. Parses + validates a backup file's text. Throws a plain Error with a
 * user-facing message on anything malformed — the dashboard shows that
 * message verbatim in its inline status line.
 */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t("backup.parse.invalidJson.error"));
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(t("backup.parse.invalidJson.error"));
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.format !== BACKUP_FORMAT) {
    throw new Error(t("backup.parse.wrongFormat.error"));
  }

  if (typeof candidate.version !== "number") {
    throw new Error(t("backup.parse.missingVersion.error"));
  }

  if (candidate.version > BACKUP_VERSION) {
    throw new Error(t("backup.parse.newerVersion.error"));
  }

  if (typeof candidate.data !== "object" || candidate.data === null || Array.isArray(candidate.data)) {
    throw new Error(t("backup.parse.noData.error"));
  }

  return {
    format: BACKUP_FORMAT,
    version: candidate.version,
    exportedAt: typeof candidate.exportedAt === "number" ? candidate.exportedAt : 0,
    extensionVersion: typeof candidate.extensionVersion === "string" ? candidate.extensionVersion : "unknown",
    data: candidate.data as Record<string, unknown>,
  };
}

export async function buildBackup(): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    extensionVersion: browser.runtime.getManifest().version,
    data: await local.dumpAll(),
  };
}

export async function downloadBackup(): Promise<void> {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  await downloadBlob(blob, backupFilename());
}

export async function restoreBackup(backup: BackupFile): Promise<void> {
  await local.replaceAll(backup.data);
}
