import { describe, expect, it } from "vitest";

import { BACKUP_FORMAT, BACKUP_VERSION, backupFilename, parseBackup } from "../src/shared/backup";

function validBackupText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 1_700_000_000_000,
    extensionVersion: "1.2.0",
    data: { activeProfile: "demo", "profile:demo:memberLinks": [] },
    ...overrides,
  });
}

describe("parseBackup", () => {
  it("accepts a well-formed backup file and returns its data", () => {
    const backup = parseBackup(validBackupText());
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.data).toEqual({ activeProfile: "demo", "profile:demo:memberLinks": [] });
  });

  it("rejects text that isn't JSON", () => {
    expect(() => parseBackup("not json {")).toThrow(/valid backup/i);
  });

  it("rejects a JSON array", () => {
    expect(() => parseBackup("[]")).toThrow(/valid backup/i);
  });

  it("rejects a file whose format marker is wrong", () => {
    expect(() => parseBackup(validBackupText({ format: "something-else" }))).toThrow(/Toastmasters VPE Assistant backup/i);
  });

  it("rejects a file with a non-numeric version", () => {
    expect(() => parseBackup(validBackupText({ version: "1" }))).toThrow(/version/i);
  });

  it("rejects a backup from a newer extension version", () => {
    expect(() => parseBackup(validBackupText({ version: BACKUP_VERSION + 1 }))).toThrow(/newer version/i);
  });

  it("rejects a file whose data field is not an object", () => {
    expect(() => parseBackup(validBackupText({ data: null }))).toThrow(/no data/i);
    expect(() => parseBackup(validBackupText({ data: [] }))).toThrow(/no data/i);
  });

  it("tolerates missing optional metadata", () => {
    const backup = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, data: {} })
    );
    expect(backup.exportedAt).toBe(0);
    expect(backup.extensionVersion).toBe("unknown");
  });
});

describe("backupFilename", () => {
  it("uses a YYYY-MM-DD date suffix", () => {
    expect(backupFilename(new Date("2026-08-29T12:34:56Z"))).toBe(`${BACKUP_FORMAT}-2026-08-29.json`);
  });
});
