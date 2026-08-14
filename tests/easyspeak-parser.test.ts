import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseProfileLinks, parseMemberchart, parseLevelCell } from "../src/shared/parsers/easyspeak-parser";

const FIXTURE_DIR = fileURLToPath(new URL("../test-data/easyspeak/", import.meta.url));

function loadDoc(filename: string): Document {
  const html = readFileSync(path.join(FIXTURE_DIR, filename), "utf8");
  return new JSDOM(html).window.document as unknown as Document;
}

describe("parseProfileLinks", () => {
  const doc = loadDoc("profile.html");
  const { clubs } = parseProfileLinks(doc);

  it("keeps only officer clubs, dropping guest-only rows", () => {
    expect(clubs).toHaveLength(2);
    expect(clubs.map((c) => c.id)).toEqual(["101", "103"]);
  });

  it("extracts id and name from the clubdata.php link", () => {
    expect(clubs[0]).toEqual({ id: "101", name: "Riverside Toastmasters" });
    expect(clubs[1]).toEqual({ id: "103", name: "Hilltop Communicators" });
  });

  it("disambiguates the club table from the unrelated 'Information on Speeches' table", () => {
    // If disambiguation failed and picked the wrong table.forumline, no
    // clubdata.php links (and thus no clubs) would have been found at all.
    expect(clubs.length).toBeGreaterThan(0);
  });

  it("returns no clubs when #tab_ti is missing", () => {
    const emptyDoc = new JSDOM("<html><body></body></html>").window.document as unknown as Document;
    expect(parseProfileLinks(emptyDoc)).toEqual({ clubs: [] });
  });
});

describe("parseMemberchart", () => {
  const doc = loadDoc("memberchart.html");
  const { members } = parseMemberchart(doc);

  it("finds the roster table by its Name/Path headers, ignoring the banner table", () => {
    expect(members.length).toBeGreaterThan(0);
  });

  it("extracts a member id from a plain href u= param", () => {
    const alice = members.find((m) => m.memberId === "501");
    expect(alice).toBeTruthy();
    expect(alice!.name).toBe("Alice Martin");
  });

  it("extracts a member id from an onclick u= param when href is javascript:void(0)", () => {
    const bob = members.find((m) => m.memberId === "502");
    expect(bob).toBeTruthy();
    expect(bob!.name).toBe("Bob Dupont");
    expect(bob!.levels[0]).toMatchObject({ level: 1, needed: 1, done: 1 });
  });

  it("preserves accented names verbatim", () => {
    const elodie = members.find((m) => m.memberId === "503");
    expect(elodie!.name).toBe("Élodie Müller");
  });

  it("preserves a name with a trailing role/honorific suffix verbatim", () => {
    const nigel = members.find((m) => m.memberId === "504");
    expect(nigel!.name).toBe("Nigel Thew CC EC2");
  });

  it("keeps one entry per path row for a multi-path member, including the \"''\" placeholder name row", () => {
    const carlaRows = members.filter((m) => m.memberId === "505");
    expect(carlaRows).toHaveLength(3);
    expect(carlaRows[0].name).toBe("Carla Ivanova");
    expect(carlaRows[0].path).toBe("Visionary Communication");
    expect(carlaRows[1].name).toBe("''");
    expect(carlaRows[1].path).toBe("Team Collaboration");
  });

  it("attributes a 3rd+ path row with no <a> link at all to the preceding member, instead of dropping it", () => {
    // Real EasySpeak markup only reliably links the first path row for a
    // multi-path member — a 3rd row can drop the <a> entirely, leaving a
    // bare placeholder <span>. That row must still be captured, attributed
    // to whichever member the previous row belonged to (table order).
    const carlaRows = members.filter((m) => m.memberId === "505");
    expect(carlaRows[2]).toMatchObject({ memberId: "505", name: "''", path: "Dynamic Leadership" });
  });

  it("throws when the roster table can't be found", () => {
    const badDoc = new JSDOM('<html><body><table class="forumline"></table></body></html>').window.document as unknown as Document;
    expect(() => parseMemberchart(badDoc)).toThrow();
  });
});

describe("parseLevelCell", () => {
  function cellFrom(html: string): Element {
    const doc = new JSDOM(`<table><tr><td id="cell">${html}</td></tr></table>`).window.document;
    return doc.getElementById("cell") as unknown as Element;
  }

  it("counts mandatory speech icons 1:1, done vs not-done", () => {
    const td = cellFrom(
      '<img src="images/icon_tick.gif"><img src="images/icon_tick_dkgreen.gif">' +
        '<img src="images/icon_box.gif"><img src="images/icon_question_bubble.gif"><img src="images/icon_clock.gif">'
    );
    expect(parseLevelCell(td)).toEqual({ needed: 5, done: 2 });
  });

  it("excludes role icons from the count entirely", () => {
    const td = cellFrom('<img src="images/icon_b_box.gif"><img src="images/icon_tick_orange.gif">');
    expect(parseLevelCell(td)).toEqual({ needed: 0, done: 0 });
  });

  it("counts an elective bucket up to its required N, capped at that N even with more ticks", () => {
    const td = cellFrom(
      '<span style="border:1px dashed #999;" title="Complete 2 elective speeches">' +
        '<img src="images/icon_tick.gif"><img src="images/icon_tick.gif"><img src="images/icon_tick_dkgreen.gif">' +
        "</span>"
    );
    expect(parseLevelCell(td)).toEqual({ needed: 2, done: 2 });
  });

  it("skips a bucket whose title doesn't match 'Complete N elective speech(es)'", () => {
    const td = cellFrom('<span style="border:1px dashed #999;" title="Successful Club Series"><img src="images/icon_tick.gif"></span>');
    expect(parseLevelCell(td)).toEqual({ needed: 0, done: 0 });
  });

  it("returns zero for an empty cell", () => {
    const td = cellFrom("");
    expect(parseLevelCell(td)).toEqual({ needed: 0, done: 0 });
  });

  it("matches the fixture's row A across all five levels (mandatory + role + capped bucket + skipped bucket)", () => {
    const doc = loadDoc("memberchart.html");
    const { members } = parseMemberchart(doc);
    const alice = members.find((m) => m.memberId === "501");
    expect(alice!.levels).toEqual([
      { level: 1, needed: 2, done: 2 },
      { level: 2, needed: 2, done: 0 },
      { level: 3, needed: 1, done: 1 },
      { level: 4, needed: 2, done: 2 },
      { level: 5, needed: 0, done: 0 },
    ]);
  });
});
