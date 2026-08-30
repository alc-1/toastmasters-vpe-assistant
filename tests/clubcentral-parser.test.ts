import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { normalizePaymentStatus, parseClubList, parseRoster } from "../src/shared/parsers/clubcentral-parser";

const FIXTURE_DIR = fileURLToPath(new URL("../test-data/clubcentral/", import.meta.url));

function loadDoc(filename: string): Document {
  const html = readFileSync(path.join(FIXTURE_DIR, filename), "utf8");
  return new JSDOM(html).window.document as unknown as Document;
}

describe("parseClubList", () => {
  const { clubs } = parseClubList(loadDoc("club-list.html"));

  it("extracts every club id from the tiles and the select", () => {
    expect(clubs.map((c) => c.id)).toEqual(["CB-00000101", "CB-00000103", "CB-00000104"]);
  });

  it("prefers the proper-case tile name", () => {
    expect(clubs[0]).toEqual({ id: "CB-00000101", name: "Riverside Toastmasters Club" });
    expect(clubs[1]).toEqual({ id: "CB-00000103", name: "Hilltop Communicators" });
  });

  it("falls back to the select option text (minus the CB- prefix) when there is no tile", () => {
    expect(clubs[2]).toEqual({ id: "CB-00000104", name: "HARBOUR SPEAKERS CLUB" });
  });

  it("returns no clubs when the landing form is absent", () => {
    const emptyDoc = new JSDOM("<html><body></body></html>").window.document as unknown as Document;
    expect(parseClubList(emptyDoc)).toEqual({ clubs: [] });
  });
});

describe("parseRoster", () => {
  const result = parseRoster(loadDoc("roster.html"));
  const { members } = result;

  it("reads the club name from the 'Currently Managing:' line", () => {
    expect(result.clubName).toBe("Riverside Toastmasters Club");
  });

  it("parses every list-view row, ignoring the decoy grid table", () => {
    expect(members).toHaveLength(5);
    expect(members.map((m) => m.name)).toEqual([
      "Ada Fernández",
      "Bruno Kovač",
      "Chloé Nwosu",
      "Devon Ramaswamy",
      "Esme Bäcklund",
    ]);
  });

  it("strips the trailing path-code span from the name", () => {
    expect(members[0].name).toBe("Ada Fernández");
    expect(members[2].name).toBe("Chloé Nwosu");
  });

  it("flags Pathways enrollment only when the marker is present", () => {
    expect(members[0].pathwaysEnrolled).toBe(true);
    expect(members[1].pathwaysEnrolled).toBe(false);
    expect(members[2].pathwaysEnrolled).toBe(true);
    expect(members[3].pathwaysEnrolled).toBe(false);
  });

  it("parses the member number and CRM id from the Edit Profile onclick", () => {
    expect(members[0].memberNumber).toBe("PN-00000001");
    expect(members[0].crmId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("leaves member number / CRM id null when the Edit Profile link is absent", () => {
    expect(members[3].memberNumber).toBeNull();
    expect(members[3].crmId).toBeNull();
  });

  it("normalizes the payment status, mapping an unknown value to 'Unknown'", () => {
    expect(members.map((m) => m.paymentStatus)).toEqual(["Paid", "Membership Pending", "Unpaid", "Paid", "Unknown"]);
  });

  it("keeps the raw Paid Until text, or null when empty", () => {
    expect(members[0].paidUntil).toBe("September 30, 2026");
    expect(members[1].paidUntil).toBeNull();
    expect(members[3].paidUntil).toBe("September 30, 2027");
  });

  it("captures the officer position when present", () => {
    expect(members[0].position).toBe("President");
    expect(members[1].position).toBe("");
  });

  it("finds the roster table by header text when it has no id", () => {
    const html = readFileSync(path.join(FIXTURE_DIR, "roster.html"), "utf8").replace('id="HtmlListViewData"', 'id="renamed"');
    const doc = new JSDOM(html).window.document as unknown as Document;
    expect(parseRoster(doc).members).toHaveLength(5);
  });

  it("throws when there is no roster table at all", () => {
    const doc = new JSDOM("<html><body><main></main></body></html>").window.document as unknown as Document;
    expect(() => parseRoster(doc)).toThrow(/roster table/i);
  });
});

describe("normalizePaymentStatus", () => {
  it("maps the three known strings and treats everything else as Unknown", () => {
    expect(normalizePaymentStatus("Paid")).toBe("Paid");
    expect(normalizePaymentStatus("  unpaid ")).toBe("Unpaid");
    expect(normalizePaymentStatus("Membership Pending")).toBe("Membership Pending");
    expect(normalizePaymentStatus("Suspended")).toBe("Unknown");
    expect(normalizePaymentStatus(null)).toBe("Unknown");
    expect(normalizePaymentStatus(undefined)).toBe("Unknown");
  });
});
