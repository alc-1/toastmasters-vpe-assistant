// report/report.js
//
// DOM glue for the comparison report page: reads the already-scraped data
// straight out of chrome.storage.local (no live scraping happens here) and
// hands it to buildReport() from lib/report.js, then renders the result.
// Kept separate from lib/report.js so the pure matching/diff logic stays
// chrome.*-free and independently testable (see lib/report.js's top comment).

const downloadCsvBtn = document.getElementById("downloadCsvBtn");
downloadCsvBtn.disabled = true;

init();

async function init() {
  const cached = await chrome.storage.local.get([
    "basecampData",
    "basecampScrapedAt",
    "easyspeakData",
    "easyspeakScrapedAt",
  ]);

  if (!cached.basecampData || !cached.easyspeakData) {
    downloadCsvBtn.style.display = "none";
    document.getElementById("conflictWarning").innerHTML = "";
    document.getElementById("clubTabs").innerHTML = "";
    document.getElementById("summaryTableRoot").innerHTML = "";
    document.getElementById("reportRoot").innerHTML =
      '<p class="empty-state">Both Basecamp and EasySpeak data are needed to build this report. ' +
      "Go back to the extension popup and run both extractions first.</p>";
    return;
  }

  document.getElementById("reportMeta").textContent =
    `Basecamp last extracted: ${formatDate(cached.basecampScrapedAt)} — ` +
    `EasySpeak last extracted: ${formatDate(cached.easyspeakScrapedAt)}`;

  // Loading persisted resolution decisions here (not just in members.js) is
  // required, not optional — otherwise this page's CSV export and Level
  // Summary would silently diverge from what the Member matching view shows.
  const resolution = await loadResolutionData();
  const report = buildReport(
    cached.basecampData,
    cached.easyspeakData,
    { basecampScrapedAt: cached.basecampScrapedAt, easyspeakScrapedAt: cached.easyspeakScrapedAt },
    // This page shows the VPE's authoritative record, so an unconfirmed
    // fuzzy guess must never render here as if it were a fact — only an
    // exact name match or an explicitly-confirmed memberLinks entry counts.
    // The Members view is where fuzzy suggestions actually get resolved.
    { ...resolution, allowFuzzyMemberMatches: false }
  );

  downloadCsvBtn.disabled = false;
  downloadCsvBtn.addEventListener("click", () => downloadCsv(report));

  renderConflictWarning(report);

  // Zipped by index: buildLevelSummary(report) produces one group per
  // report.clubPairs entry, in the same order, so a tab can drive both the
  // summary table and the member-list detail for the same club together.
  const summaryGroups = buildLevelSummary(report);
  const clubSections = report.clubPairs.map((clubPair, index) => ({
    clubKey: summaryGroups[index].clubKey,
    clubName: summaryGroups[index].clubName,
    summaryRows: summaryGroups[index].rows,
    clubPair,
  }));

  renderClubTabs(clubSections);
}

// ---------------------------------------------------------------------------
// Conflict warning banner: flags clubs with no counterpart at all in the
// other system, and members left unmatched within a matched club pair (an
// unconfirmed fuzzy guess counts as unmatched here too, since this page
// excludes those — see the allowFuzzyMemberMatches: false call above).
// ---------------------------------------------------------------------------

// An inline SVG rather than the "⚠" character: at small sizes (and
// especially in bold), that glyph's triangle-and-exclamation strokes
// depend entirely on the system's emoji font and can blur into an
// unreadable blob. Plain vector shapes stay crisp at any size.
// Keeping all three icon candidates side by side for now (at 24px) so they
// can be visually compared before settling on one — see conversation.
function warningIconHtml(title) {
  return `
    <span class="warning-icon" title="${escapeAttr(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960" fill="#EA3323"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm330.5-51.5Q520-263 520-280t-11.5-28.5Q497-320 480-320t-28.5 11.5Q440-297 440-280t11.5 28.5Q463-240 480-240t28.5-11.5ZM440-360h80v-200h-80v200Zm40-100Z"/></svg>
    </span>
  `;
}

function renderConflictWarning(report) {
  const root = document.getElementById("conflictWarning");

  const unmatchedClubCount = report.clubPairs.filter((c) => !c.basecampClubId || !c.easyspeakClubId).length;
  const unmatchedMemberCount = report.clubPairs.reduce(
    (sum, c) => sum + c.members.filter((m) => m.presence !== "both").length,
    0
  );

  if (unmatchedClubCount === 0 && unmatchedMemberCount === 0) {
    root.innerHTML = "";
    return;
  }

  const parts = [];
  if (unmatchedClubCount > 0) parts.push(`${unmatchedClubCount} club${unmatchedClubCount === 1 ? "" : "s"}`);
  if (unmatchedMemberCount > 0) parts.push(`${unmatchedMemberCount} member${unmatchedMemberCount === 1 ? "" : "s"}`);

  const fixLinks = [
    unmatchedClubCount > 0 ? '<a href="../settings/settings.html">Fix club matches in Settings</a>' : "",
    unmatchedMemberCount > 0 ? '<a href="../members/members.html">Fix member matches in Member matching</a>' : "",
  ].filter(Boolean);

  root.innerHTML = `
    <div class="conflict-warning">
      ${warningIconHtml("Conflicts found")}
      ${parts.join(" and ")} without a match between Basecamp and EasySpeak.
      ${fixLinks.join(" · ")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Club tabs: each tab drives both the "Next Level Summary" table and the
// "Member List" detail view for the same club together.
// ---------------------------------------------------------------------------

const SUMMARY_COLUMNS = [
  { key: "memberName", label: "Member", type: "string", colClass: "col-member" },
  { key: "pathName", label: "Path", type: "string", colClass: "col-path" },
  { key: "currentLevelSortValue", label: "Current Level", type: "number", colClass: "col-level" },
  { key: "theoreticalMissing", label: "To Next Lvl (Basecamp)", type: "number", colClass: "col-basecamp" },
  { key: "unreportedInBasecamp", label: "Unreported (Basecamp)", type: "number", colClass: "col-unreported" },
  { key: "realMissing", label: "To Next Lvl (Real)", type: "number", colClass: "col-real" },
];

let clubSections = [];
let activeClubKey = null;
let summaryRows = [];
let summarySort = { key: "realMissing", direction: "asc" };

function renderClubTabs(sections) {
  clubSections = sections;
  const tabsRoot = document.getElementById("clubTabs");

  if (sections.length === 0) {
    document.getElementById("conflictWarning").innerHTML = "";
    tabsRoot.innerHTML = "";
    document.getElementById("summaryTableRoot").innerHTML = "";
    document.getElementById("reportRoot").innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
    return;
  }

  activeClubKey = sections[0].clubKey;
  tabsRoot.innerHTML = sections
    .map((s) => {
      const unmatched = !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId;
      const warningIcon = unmatched
        ? warningIconHtml("No match found between Basecamp and EasySpeak for this club")
        : "";
      return `<button class="tab-btn" data-club-key="${s.clubKey}">${warningIcon}${escapeHtml(s.clubName ?? "(unnamed club)")}</button>`;
    })
    .join("");

  tabsRoot.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeClubKey = btn.dataset.clubKey;
      updateActiveTab();
      renderActiveClub();
    });
  });

  updateActiveTab();
  renderActiveClub();
}

function updateActiveTab() {
  document.querySelectorAll("#clubTabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.clubKey === activeClubKey);
  });
}

// Sort state (summarySort) is shared across tabs on purpose — switching
// clubs shouldn't reset how the VPE has the list sorted.
function renderActiveClub() {
  const section = clubSections.find((s) => s.clubKey === activeClubKey);
  renderSummaryTable(section ? section.summaryRows : []);
  document.getElementById("reportRoot").innerHTML = section ? renderClubDetail(section.clubPair) : "";
}

function renderSummaryTable(rows) {
  summaryRows = rows;
  const root = document.getElementById("summaryTableRoot");

  if (rows.length === 0) {
    root.innerHTML = '<p class="empty-state">No Pathways paths found.</p>';
    return;
  }

  const colgroupHtml = SUMMARY_COLUMNS.map((col) => `<col class="${col.colClass}">`).join("");
  const theadHtml = SUMMARY_COLUMNS.map((col) => `<th data-key="${col.key}">${escapeHtml(col.label)}</th>`).join("");
  root.innerHTML = `<table class="summary"><colgroup>${colgroupHtml}</colgroup><thead><tr>${theadHtml}</tr></thead><tbody></tbody></table>`;

  root.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      summarySort =
        summarySort.key === key
          ? { key, direction: summarySort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" };
      updateSummaryHeaders();
      renderSummaryBody();
    });
  });

  updateSummaryHeaders();
  renderSummaryBody();
}

function updateSummaryHeaders() {
  document.querySelectorAll("table.summary th").forEach((th) => {
    const col = SUMMARY_COLUMNS.find((c) => c.key === th.dataset.key);
    const isActive = th.dataset.key === summarySort.key;
    const arrow = isActive ? (summarySort.direction === "asc" ? " ▲" : " ▼") : "";
    th.innerHTML = `${escapeHtml(col.label)}${arrow ? `<span class="sort-indicator">${arrow}</span>` : ""}`;
  });
}

function renderSummaryBody() {
  const tbody = document.querySelector("table.summary tbody");
  const sorted = [...summaryRows].sort((a, b) => compareSummaryRows(a, b, summarySort.key, summarySort.direction));
  tbody.innerHTML = sorted.map(renderSummaryRow).join("");
}

// Nulls (e.g. "Not in Basecamp"/"Completed" rows with no speech counts to
// compare) always sort last, regardless of ascending/descending — they're
// "not applicable", not a real ranking value.
function compareSummaryRows(a, b, key, direction) {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

function renderSummaryRow(row) {
  const muted = row.currentLevelLabel === "Completed" || row.currentLevelLabel === "Not in Basecamp";
  return `
    <tr class="${muted ? "muted-row" : ""}">
      <td>${escapeHtml(row.memberName)}</td>
      <td>${escapeHtml(row.pathName)} <span class="badge badge-${row.pathPresence}">${presenceLabel(row.pathPresence)}</span></td>
      <td>${escapeHtml(row.currentLevelLabel)}</td>
      <td class="numeric">${row.theoreticalMissing ?? "—"}</td>
      <td class="numeric">${row.unreportedInBasecamp ?? "—"}</td>
      <td class="numeric">${row.realMissing ?? "—"}</td>
    </tr>
  `;
}

function downloadCsv(report) {
  const csv = toCsv(reportToRows(report));
  // Leading BOM so Excel detects UTF-8 (member/path names carry accents).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `toastmasters-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderClubDetail(clubPair) {
  const { basecampClubName, easyspeakClubName, matchScore, clubMatchForced, members } = clubPair;

  let matchNote;
  if (basecampClubName && easyspeakClubName) {
    const scoreText = clubMatchForced ? "pinned in Settings" : `match ${Math.round(matchScore * 100)}%`;
    matchNote = `${escapeHtml(basecampClubName)} / ${escapeHtml(easyspeakClubName)} — ${scoreText}`;
  } else if (basecampClubName) {
    matchNote = `${escapeHtml(basecampClubName)} (no EasySpeak counterpart found)`;
  } else {
    matchNote = `${escapeHtml(easyspeakClubName)} (no Basecamp counterpart found)`;
  }

  const both = members.filter((m) => m.presence === "both").length;
  const fuzzy = members.filter((m) => m.matchConfidence === "fuzzy").length;
  const bcOnly = members.filter((m) => m.presence === "basecamp-only").length;
  const esOnly = members.filter((m) => m.presence === "easyspeak-only").length;

  // members[] comes out in match-assignment order (matched pairs first,
  // then leftovers) — sort alphabetically for a predictable, scannable list.
  const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return `
    <div class="club-summary">
      ${matchNote} · ${members.length} member(s) — ${both} in both (${fuzzy} fuzzy match${fuzzy === 1 ? "" : "es"}),
      ${bcOnly} Basecamp-only, ${esOnly} EasySpeak-only
    </div>
    ${sortedMembers.map(renderMember).join("")}
  `;
}

function renderMember(member) {
  const presenceBadge = `<span class="badge badge-${member.presence}">${presenceLabel(member.presence)}</span>`;
  const scoreTitle = member.matchScore != null ? ` title="match score: ${member.matchScore.toFixed(2)}"` : "";
  const confidenceBadge = member.matchConfidence
    ? `<span class="badge badge-${member.matchConfidence}"${scoreTitle}>${member.matchConfidence}</span>`
    : "";

  const noActivePathNote = member.easyspeakNoActivePath
    ? '<div class="no-active-path">No active EasySpeak path.</div>'
    : "";

  const pathsHtml = member.paths.map(renderPath).join("");

  return `
    <details class="member">
      <summary>
        <span class="member-name">${escapeHtml(member.name)}</span>
        ${presenceBadge}
        ${confidenceBadge}
      </summary>
      ${noActivePathNote}
      ${pathsHtml || '<div class="non-pathway-note">No paths found.</div>'}
    </details>
  `;
}

function presenceLabel(presence) {
  if (presence === "both") return "In both";
  if (presence === "basecamp-only") return "Basecamp only";
  return "EasySpeak only";
}

function renderPath(path) {
  const presenceNote = path.presence === "both" ? "" : ` (${presenceLabel(path.presence)})`;

  if (path.nonPathway) {
    return `
      <div class="path-block">
        <div class="path-title">${escapeHtml(path.displayName)}<span class="path-presence">${presenceNote}</span></div>
        <div class="non-pathway-note">Non-Pathways activity, not compared.</div>
      </div>
    `;
  }

  return `
    <div class="path-block">
      <div class="path-title">${escapeHtml(path.displayName)}<span class="path-presence">${presenceNote}</span></div>
      <table class="levels">
        <tr>
          <th>Level</th>
          <th>EasySpeak (done/needed)</th>
          <th>Basecamp (completed/total)</th>
          <th>Approved</th>
          <th>Missing (ES)</th>
          <th>Missing (BC)</th>
          <th>Discrepancy</th>
          <th>Pending validation</th>
        </tr>
        ${path.levels.map(renderLevelRow).join("")}
        ${renderPathCompletionRow(path.pathCompletion)}
      </table>
    </div>
  `;
}

function renderLevelRow(level) {
  const rowClass = level.pendingValidation ? "pending" : level.discrepancy ? "discrepancy" : "";
  return `
    <tr class="${rowClass}">
      <td>${level.level}</td>
      <td>${level.easyspeak ? `${level.easyspeak.done}/${level.easyspeak.needed}` : "—"}</td>
      <td>${level.basecamp ? `${level.basecamp.completed}/${level.basecamp.total}` : "—"}</td>
      <td>${level.basecamp ? (level.basecamp.approved ? "Yes" : "No") : "—"}</td>
      <td>${level.easyspeakMissing ?? "—"}</td>
      <td>${level.basecampMissing ?? "—"}</td>
      <td>${level.discrepancy ?? "—"}</td>
      <td>${level.pendingValidation ? "Yes" : "No"}</td>
    </tr>
  `;
}

function renderPathCompletionRow(pathCompletion) {
  if (!pathCompletion) return "";
  return `
    <tr class="completion-row">
      <td>Path Completion</td>
      <td>—</td>
      <td>${pathCompletion.completed}/${pathCompletion.total}</td>
      <td>—</td>
      <td>—</td>
      <td>${pathCompletion.missing}</td>
      <td>—</td>
      <td>—</td>
    </tr>
  `;
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString("en-US") : "never";
}
