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
    document.getElementById("reportRoot").innerHTML =
      '<p class="empty-state">Both Basecamp and EasySpeak data are needed to build this report. ' +
      "Go back to the extension popup and run both extractions first.</p>";
    return;
  }

  document.getElementById("reportMeta").textContent =
    `Basecamp last extracted: ${formatDate(cached.basecampScrapedAt)} — ` +
    `EasySpeak last extracted: ${formatDate(cached.easyspeakScrapedAt)}`;

  const report = buildReport(cached.basecampData, cached.easyspeakData, {
    basecampScrapedAt: cached.basecampScrapedAt,
    easyspeakScrapedAt: cached.easyspeakScrapedAt,
  });

  downloadCsvBtn.disabled = false;
  downloadCsvBtn.addEventListener("click", () => downloadCsv(report));

  render(report);
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

function render(report) {
  const root = document.getElementById("reportRoot");
  if (report.clubPairs.length === 0) {
    root.innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
    return;
  }
  root.innerHTML = report.clubPairs.map(renderClubSection).join("");
}

function renderClubSection(clubPair) {
  const { basecampClubName, easyspeakClubName, matchScore, members } = clubPair;

  let heading;
  if (basecampClubName && easyspeakClubName) {
    heading = `${escapeHtml(basecampClubName)} / ${escapeHtml(easyspeakClubName)} — match ${Math.round(matchScore * 100)}%`;
  } else if (basecampClubName) {
    heading = `${escapeHtml(basecampClubName)} (no EasySpeak counterpart found)`;
  } else {
    heading = `${escapeHtml(easyspeakClubName)} (no Basecamp counterpart found)`;
  }

  const both = members.filter((m) => m.presence === "both").length;
  const fuzzy = members.filter((m) => m.matchConfidence === "fuzzy").length;
  const bcOnly = members.filter((m) => m.presence === "basecamp-only").length;
  const esOnly = members.filter((m) => m.presence === "easyspeak-only").length;

  return `
    <section>
      <h2>${heading}</h2>
      <div class="club-summary">
        ${members.length} member(s) — ${both} in both (${fuzzy} fuzzy match${fuzzy === 1 ? "" : "es"}),
        ${bcOnly} Basecamp-only, ${esOnly} EasySpeak-only
      </div>
      ${members.map(renderMember).join("")}
    </section>
  `;
}

function renderMember(member) {
  const presenceBadge = `<span class="badge badge-${member.presence}">${presenceLabel(member.presence)}</span>`;
  const confidenceBadge = member.matchConfidence
    ? `<span class="badge badge-${member.matchConfidence}" title="match score: ${member.matchScore.toFixed(2)}">${member.matchConfidence}</span>`
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
