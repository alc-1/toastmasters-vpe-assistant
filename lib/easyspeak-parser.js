// lib/easyspeak-parser.js
//
// Pure DOM-parsing logic for EasySpeak pages. Injected via
// chrome.scripting.executeScript into a real, navigated tmclub.eu tab (see
// lib/easyspeak-api.js) — tmclub.eu sits behind Cloudflare, which blocks
// programmatic fetch()/XHR requests (distinguishable from a real page
// navigation via the Sec-Fetch-Mode/Sec-Fetch-Dest headers) regardless of
// which extension context issues them, so there is no fetch-and-parse-
// elsewhere option here: parsing has to happen against the tab's own live
// document. No chrome.runtime dependency — these functions become globals
// (window.parseProfileLinks etc.) in the injected tab, then get invoked
// directly by name.

const SPEECH_ICONS = new Set([
  "icon_box.gif",
  "icon_tick.gif",
  "icon_tick_dkgreen.gif",
  "icon_question_bubble.gif",
  "icon_clock.gif",
]);

const DONE_ICONS = new Set(["icon_tick.gif", "icon_tick_dkgreen.gif"]);

/**
 * Extracts the clubs where the logged-in user is a club officer from the
 * "Connected to these Toastmaster clubs" table under the #tab_ti tab on
 * profile.php?mode=editprofile#tab_ti. That table also lists clubs where
 * the user is merely a guest — those rows are filtered out, keeping only
 * rows whose officer-icon cell contains icon_club_exec.gif.
 * @param {Document} doc
 * @returns {{clubs: {id: string, name: string}[]}}
 */
function parseProfileLinks(doc = document) {
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

  const clubs = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter((el) => el.tagName === "TD");
    // Expected columns: Name, Role, Officer icon, Joined date, Last visit,
    // Last role, Last spoke, Mentor.
    if (cells.length < 3) continue;

    const nameCell = cells[0];
    const officerCell = cells[2];

    const isOfficer = Array.from(officerCell.querySelectorAll("img")).some((img) =>
      (img.getAttribute("src") || "").includes("icon_club_exec.gif")
    );
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
 * @param {Document} doc
 * @returns {{members: object[]}}
 */
function parseMemberchart(doc = document) {
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

  const members = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter((el) => el.tagName === "TD");
    // Expected columns: Name, Action, Last spoke, 1, 2, 3, 4, 5, Path.
    if (cells.length < 9) continue;

    const nameCell = cells[0];
    const levelCells = cells.slice(3, 8);
    const pathCell = cells[cells.length - 1];

    const link = nameCell.querySelector("a");
    if (!link) continue;

    // Some members are linked via onclick (javascript:void(0) href) instead
    // of a direct href — check both for the "u=<id>" member id.
    const idSource = `${link.getAttribute("href") || ""} ${link.getAttribute("onclick") || ""}`;
    const idMatch = idSource.match(/u=(\d+)/);
    const memberId = idMatch ? idMatch[1] : null;
    const name = (link.textContent || "").trim();
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
 * @param {Element} td
 * @returns {{needed: number, done: number}}
 */
function parseLevelCell(td) {
  let needed = 0;
  let done = 0;

  function isBucket(el) {
    return el.tagName === "SPAN" && (el.getAttribute("style") || "").includes("border:1px dashed");
  }

  function iconFilename(imgEl) {
    const src = imgEl.getAttribute("src") || "";
    const match = src.match(/icon_[a-z_]+\.gif/i);
    return match ? match[0].toLowerCase() : "";
  }

  function walk(node) {
    for (const child of Array.from(node.children)) {
      if (isBucket(child)) {
        const title = child.getAttribute("title") || "";
        const match = title.match(/^Complete (\d+) elective speech/i);
        if (match) {
          const required = parseInt(match[1], 10);
          const ticks = Array.from(child.querySelectorAll("img")).filter((img) =>
            DONE_ICONS.has(iconFilename(img))
          ).length;
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

// Exposed as globals: injected via chrome.scripting into the live EasySpeak
// tab (see lib/easyspeak-api.js), and via module.exports for standalone
// Node/jsdom testing — same pattern as lib/report.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseProfileLinks, parseMemberchart, parseLevelCell };
}
