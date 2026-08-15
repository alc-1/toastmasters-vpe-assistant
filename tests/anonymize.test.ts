import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReport, memberKey } from "../src/shared/sync/delta";
import { anonymizeBasecampScrape, anonymizeEasySpeakScrape, anonymizeReport, buildAnonymizationMaps } from "../src/shared/anonymize";
import type { BasecampScrape, EasySpeakScrape } from "../src/shared/types";

const DATA_DIR = fileURLToPath(new URL("../test-data/report/", import.meta.url));
const basecampData: BasecampScrape = JSON.parse(readFileSync(DATA_DIR + "basecampData.sample.json", "utf8"));
const easyspeakData: EasySpeakScrape = JSON.parse(readFileSync(DATA_DIR + "easyspeakData.sample.json", "utf8"));

// ---------------------------------------------------------------------------
// buildAnonymizationMaps / anonymizeReport
// ---------------------------------------------------------------------------

describe("anonymizeReport", () => {
  const report = buildReport(basecampData, easyspeakData);
  const maps = buildAnonymizationMaps(report);
  const anonymized = anonymizeReport(report, maps);

  it("labels clubs sequentially in report.clubPairs order", () => {
    anonymized.clubPairs.forEach((pair, i) => {
      const label = `Club ${i + 1}`;
      if (pair.basecampClubId != null) expect(pair.basecampClubName).toBe(label);
      if (pair.easyspeakClubId != null) expect(pair.easyspeakClubName).toBe(label);
    });
  });

  it("labels members sequentially within each club, resetting per club", () => {
    anonymized.clubPairs.forEach((pair) => {
      pair.members.forEach((member, i) => {
        expect(member.name).toBe(`Member ${i + 1}`);
      });
    });
  });

  it("collapses a matched member's name/basecampName/easyspeakName to the same label", () => {
    const grace = anonymized.clubPairs.flatMap((c) => c.members).find((m) => m.basecampUserId === 9001)!;
    expect(grace.basecampName).toBe(grace.name);
    expect(grace.easyspeakName).toBe(grace.name);
  });

  it("leaves the absent side null for a one-sided member/club", () => {
    const onlyClub = anonymized.clubPairs.find((c) => c.easyspeakClubId === null)!;
    expect(onlyClub.easyspeakClubName).toBeNull();
    const ingrid = onlyClub.members.find((m) => m.basecampUserId === 9101)!;
    expect(ingrid.easyspeakName).toBeNull();
    expect(ingrid.basecampName).toBe(ingrid.name);
  });

  it("never leaks a real name anywhere in the anonymized report", () => {
    const json = JSON.stringify(anonymized);
    expect(json).not.toContain("Grace Thompson");
    expect(json).not.toContain("Helena Voss");
    expect(json).not.toContain("Riverside Toastmasters");
  });

  it("is deterministic across independent map builds from the same report", () => {
    const again = anonymizeReport(report, buildAnonymizationMaps(report));
    expect(again).toEqual(anonymized);
  });
});

// ---------------------------------------------------------------------------
// anonymizeBasecampScrape / anonymizeEasySpeakScrape, driven by report maps
// ---------------------------------------------------------------------------

describe("anonymizeBasecampScrape / anonymizeEasySpeakScrape with maps", () => {
  const report = buildReport(basecampData, easyspeakData);
  const maps = buildAnonymizationMaps(report);
  const anonymizedReportResult = anonymizeReport(report, maps);
  const anonymizedBasecamp = anonymizeBasecampScrape(basecampData, maps);
  const anonymizedEasySpeak = anonymizeEasySpeakScrape(easyspeakData, maps);

  it("labels the same person identically across the report and both raw scrapes", () => {
    const grace = anonymizedReportResult.clubPairs.flatMap((c) => c.members).find((m) => m.basecampUserId === 9001)!;

    const graceInBasecamp = anonymizedBasecamp["bcclub-riverside"].members.find((m) => m.user.id === 9001)!;
    expect(graceInBasecamp.user.name).toBe(grace.name);

    const graceInEasySpeak = anonymizedEasySpeak["201"].members.find((m) => m.memberId === "301")!;
    expect(graceInEasySpeak.name).toBe(grace.name);
  });

  it("labels the same club identically across the report and both raw scrapes", () => {
    const pair = anonymizedReportResult.clubPairs.find((p) => p.basecampClubId === "bcclub-riverside")!;
    expect(anonymizedBasecamp["bcclub-riverside"].name).toBe(pair.basecampClubName);
    expect(anonymizedEasySpeak["201"].name).toBe(pair.easyspeakClubName);
  });

  it("scrubs the real name out of every row, including repeated rows for the same club", () => {
    const json = JSON.stringify(anonymizedBasecamp) + JSON.stringify(anonymizedEasySpeak);
    expect(json).not.toContain("Grace Thompson");
    expect(json).not.toContain("Riverside Toastmasters");
  });
});

// ---------------------------------------------------------------------------
// Standalone mode (no maps) — used by the Sync Data raw-scrape preview,
// which anonymizes a single just-scraped source with no matched report yet.
// ---------------------------------------------------------------------------

describe("anonymizeBasecampScrape / anonymizeEasySpeakScrape without maps", () => {
  it("self-numbers clubs and members sequentially from the scrape's own order", () => {
    const anonymized = anonymizeBasecampScrape(basecampData);
    const clubIds = Object.keys(basecampData);
    clubIds.forEach((clubId, i) => {
      expect(anonymized[clubId].name).toBe(`Club ${i + 1}`);
      anonymized[clubId].members.forEach((member, j) => {
        expect(member.user.name).toBe(`Member ${j + 1}`);
      });
    });
  });

  it("is deterministic across repeated calls on the same input", () => {
    expect(anonymizeBasecampScrape(basecampData)).toEqual(anonymizeBasecampScrape(basecampData));
    expect(anonymizeEasySpeakScrape(easyspeakData)).toEqual(anonymizeEasySpeakScrape(easyspeakData));
  });

  it("gives every row for the same member within a club the identical label (Basecamp)", () => {
    const twoPathScrape: BasecampScrape = {
      club1: {
        name: "Some Club",
        members: [
          { user: { id: 1, name: "Alice" }, path_name: "Path A", progression: {} },
          { user: { id: 2, name: "Bob" }, path_name: "Path B", progression: {} },
          { user: { id: 1, name: "Alice" }, path_name: "Path C", progression: {} },
        ],
      },
    };
    const anonymized = anonymizeBasecampScrape(twoPathScrape);
    const [alice1, bob, alice2] = anonymized.club1.members;
    expect(alice1.user.name).toBe("Member 1");
    expect(bob.user.name).toBe("Member 2");
    expect(alice2.user.name).toBe(alice1.user.name);
  });

  it("gives every row for the same member within a club the identical label (EasySpeak)", () => {
    const twoPathScrape: EasySpeakScrape = {
      club1: {
        name: "Some Club",
        members: [
          { memberId: "1", name: "Alice", path: "Path A", levels: [] },
          { memberId: "2", name: "Bob", path: "Path B", levels: [] },
          { memberId: "1", name: "Alice", path: "Path C", levels: [] },
        ],
      },
    };
    const anonymized = anonymizeEasySpeakScrape(twoPathScrape);
    const [alice1, bob, alice2] = anonymized.club1.members;
    expect(alice1.name).toBe("Member 1");
    expect(bob.name).toBe("Member 2");
    expect(alice2.name).toBe(alice1.name);
  });
});

// ---------------------------------------------------------------------------
// memberKey() sanity — the join key both maps.memberLabelByMemberKey and
// this module's report-level anonymization rely on.
// ---------------------------------------------------------------------------

describe("buildAnonymizationMaps", () => {
  it("keys memberLabelByMemberKey with the same memberKey() the rest of the app uses", () => {
    const report = buildReport(basecampData, easyspeakData);
    const maps = buildAnonymizationMaps(report);
    const grace = report.clubPairs.flatMap((c) => c.members).find((m) => m.basecampUserId === 9001)!;
    expect(maps.memberLabelByMemberKey.get(memberKey(grace))).toBeDefined();
  });
});
