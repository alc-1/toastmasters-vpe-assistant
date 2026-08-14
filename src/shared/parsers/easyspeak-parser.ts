// src/shared/parsers/easyspeak-parser.ts
//
// Pure DOM-parsing logic for EasySpeak pages. No chrome.* dependency at all
// — takes a Document, returns plain data. This is what src/content/
// easyspeak-parser.iife.ts imports and exposes as globals for injection into
// a live, navigated EasySpeak tab (see background/api/easyspeak.ts) — tmclub.eu
// sits behind Cloudflare, which blocks programmatic fetch()/XHR requests
// regardless of which extension context issues them, so there is no
// fetch-and-parse-elsewhere option here: parsing has to happen against the
// tab's own live document. Also directly imported by tests/easyspeak-parser.test.ts.

import type { LevelCellCounts, MemberchartParseResult, ProfileParseResult } from "../types";

const SPEECH_ICONS = new Set(["icon_box.gif", "icon_tick.gif", "icon_tick_dkgreen.gif", "icon_question_bubble.gif", "icon_clock.gif"]);

const DONE_ICONS = new Set(["icon_tick.gif", "icon_tick_dkgreen.gif"]);

/**
 * Extracts the clubs where the logged-in user is a club officer from the
 * "Connected to these Toastmaster clubs" table under the #tab_ti tab on
 * profile.php?mode=editprofile#tab_ti. That table also lists clubs where
 * the user is merely a guest — those rows are filtered out, keeping only
 * rows whose officer-icon cell contains icon_club_exec.gif.
 */
export function parseProfileLinks(doc: Document = document): ProfileParseResult {
  const container = doc.querySelector("#tab_ti");
  if (!container) return { clubs: [] };

  // #tab_ti has more than one table.forumline (e.g. "Information on
  // Speeches" further down) — identify the club table by content, the same
  // way parseMemberchart disambiguates its own table.forumline.
  const table = Array.from(container.querySelectorAll("table.forumline")).find((candidate) =>
    candidate.querySelector('a[href^="clubdata.php?c="]')
  );
  if (!table) return { clubs: [] };

  const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.querySelector("td"));

  const clubs: ProfileParseResult["clubs"] = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter((el): el is HTMLTableCellElement => el.tagName === "TD");
    // Expected columns: Name, Role, Officer icon, Joined date, Last visit,
    // Last role, Last spoke, Mentor.
    if (cells.length < 3) continue;

    const nameCell = cells[0];
    const officerCell = cells[2];

    const isOfficer = Array.from(officerCell.querySelectorAll("img")).some((img) => (img.getAttribute("src") || "").includes("icon_club_exec.gif"));
    if (!isOfficer) continue;

    // Also naturally skips the column-header row above the club rows,
    // which has no such link in its first cell.
    const link = nameCell.querySelector('a[href^="clubdata.php?c="]');
    if (!link) continue;

    const href = link.getAttribute("href") || "";
    const match = href.match(/[?&]c=(\d+)/);
    if (!match) continue;

    clubs.push({ id: match[1], name: (link.textContent || "").trim() });
  }

  return { clubs };
}

/**
 * Extracts, from a club's memberchart.php?chart=10 roster table, one entry
 * per member x path row: member id/name, path name, and needed/done speech
 * counts for levels 1-5.
 */
export function parseMemberchart(doc: Document = document): MemberchartParseResult {
  // The page has several unrelated table.forumline elements (e.g. an
  // announcement banner) — identify the roster table specifically by its
  // "Name"/"Path" column headers.
  const table = Array.from(doc.querySelectorAll("table.forumline")).find((candidate) => {
    const headers = Array.from(candidate.querySelectorAll("th")).map((th) => (th.textContent || "").trim());
    return headers.includes("Name") && headers.includes("Path");
  });
  if (!table) {
    throw new Error("Could not find the member roster table in the memberchart response.");
  }

  const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.querySelector("td"));

  const members: MemberchartParseResult["members"] = [];
  // EasySpeak only reliably links the *first* path row for a multi-path
  // member — a 2nd row usually repeats the same u=<id> link around its "''"
  // placeholder name, but a 3rd+ row sometimes drops the <a> entirely,
  // leaving a bare <span>&nbsp;...''</span> with no id anywhere in it. Such
  // a row must still be attributed to the member whose row precedes it
  // (table order), not silently dropped — dropping it was losing that
  // member's 3rd/4th/... path entirely, not just its displayed name.
  let lastMemberId: string | null = null;
  for (const row of rows) {
    const cells = Array.from(row.children).filter((el): el is HTMLTableCellElement => el.tagName === "TD");
    // Expected columns: Name, Action, Last spoke, 1, 2, 3, 4, 5, Path.
    if (cells.length < 9) continue;

    const nameCell = cells[0];
    const levelCells = cells.slice(3, 8);
    const pathCell = cells[cells.length - 1];

    const link = nameCell.querySelector("a");
    let memberId: string | null;
    let name: string;
    if (link) {
      // Some members are linked via onclick (javascript:void(0) href)
      // instead of a direct href — check both for the "u=<id>" member id.
      const idSource = `${link.getAttribute("href") || ""} ${link.getAttribute("onclick") || ""}`;
      const idMatch = idSource.match(/u=(\d+)/);
      memberId = idMatch ? idMatch[1] : lastMemberId;
      name = (link.textContent || "").trim();
    } else {
      memberId = lastMemberId;
      name = (nameCell.textContent || "").trim();
    }
    if (!memberId) continue;
    lastMemberId = memberId;

    const path = (pathCell.textContent || "").trim();

    const levels = levelCells.map((td, index) => ({
      level: index + 1,
      ...parseLevelCell(td),
    }));

    members.push({ memberId, name, path, levels });
  }

  return { members };
}

/**
 * Counts needed/done speeches for one level cell.
 *
 * Mandatory speech icons sitting directly in the cell (optionally wrapped
 * by a plain <a> or <span class="gensmall">) each count as 1 needed, +1
 * done if ticked. Role icons (icon_b_box/icon_tick_orange) are ignored.
 * "Bucket" spans (style contains "border:1px dashed") are only counted
 * when their title is "Complete N elective speech(es)" — contributing N
 * to needed and min(ticks in the bucket, N) to done; every other bucket
 * type (roles, Successful/Better Speaker/Leadership series) is skipped.
 */
export function parseLevelCell(td: Element): LevelCellCounts {
  let needed = 0;
  let done = 0;

  function isBucket(el: Element): boolean {
    return el.tagName === "SPAN" && (el.getAttribute("style") || "").includes("border:1px dashed");
  }

  function iconFilename(imgEl: Element): string {
    const src = imgEl.getAttribute("src") || "";
    const match = src.match(/icon_[a-z_]+\.gif/i);
    return match ? match[0].toLowerCase() : "";
  }

  function walk(node: Element) {
    for (const child of Array.from(node.children)) {
      if (isBucket(child)) {
        const title = child.getAttribute("title") || "";
        const match = title.match(/^Complete (\d+) elective speech/i);
        if (match) {
          const required = parseInt(match[1], 10);
          const ticks = Array.from(child.querySelectorAll("img")).filter((img) => DONE_ICONS.has(iconFilename(img))).length;
          needed += required;
          done += Math.min(ticks, required);
        }
        continue;
      }

      if (child.tagName === "IMG") {
        const icon = iconFilename(child);
        if (SPEECH_ICONS.has(icon)) {
          needed += 1;
          if (DONE_ICONS.has(icon)) done += 1;
        }
        continue;
      }

      walk(child);
    }
  }

  walk(td);
  return { needed, done };
}
