// src/entrypoints/whats-new/main.ts
//
// The What's New page — a standalone tab opened by entrypoints/background.ts's
// onInstalled("update") handler with ?from=<previousVersion>, or visited
// directly with no query string (in which case every entry, from the
// beginning, is shown by default — see shared/whats-new-filter.ts). Content
// comes from changelog.json, bundled into every build at build time from
// CHANGELOG.md (see scripts/generate-changelog-json.ts) — not fetched from
// anywhere at runtime, so this works offline and always matches the build
// it's inside. No browser.storage dependency at all: which entries to show
// is derived entirely from the current manifest version + the "since"
// version (the ?from= query param initially, then whatever the dropdown
// below is set to), via shared/whats-new-filter.ts's selectVisibleEntries().

import { escapeAttr, escapeHtml } from "../../shared/dom-utils";
import { selectVisibleEntries } from "../../shared/whats-new-filter";
import type { ChangelogEntry } from "../../shared/whats-new-types";

const fromRoot = document.getElementById("whatsNewFromRoot")!;
const listRoot = document.getElementById("whatsNewListRoot")!;

function renderEntry(entry: ChangelogEntry): string {
  const sections = entry.sections
    .map(
      (section) => `
        <div class="whats-new__section">
          <h3 class="whats-new__section-title">${escapeHtml(section.heading)}</h3>
          <ul class="whats-new__list">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      `,
    )
    .join("");

  return `
    <div class="card">
      <div class="card-header whats-new__card-header">
        <span class="card-header__title">Version ${escapeHtml(entry.version)}</span>
        <span class="whats-new__date">${escapeHtml(entry.date)}</span>
      </div>
      <div class="card-body">${sections}</div>
    </div>
  `;
}

function renderList(entries: ChangelogEntry[]): void {
  listRoot.innerHTML = entries.length
    ? entries.map(renderEntry).join("")
    : `<p class="help-text">No changelog entries available for this version.</p>`;
}

// `changelog` is newest-first already (see scripts/changelog.ts's
// parseChangelog) — reused as-is for the dropdown's option order, "From the
// beginning" pinned above it as the empty-value default option.
function renderFromSelect(changelog: ChangelogEntry[], selected: string | null): HTMLSelectElement {
  const options = [
    `<option value="">From the beginning</option>`,
    ...changelog.map((e) => `<option value="${escapeAttr(e.version)}">Since v${escapeHtml(e.version)}</option>`),
  ].join("");

  fromRoot.innerHTML = `
    <label class="whats-new__from-label" for="whatsNewFromSelect">Show changes</label>
    <select id="whatsNewFromSelect" class="whats-new__from-select">${options}</select>
  `;

  const select = document.getElementById("whatsNewFromSelect") as HTMLSelectElement;
  select.value = selected ?? "";
  return select;
}

async function init() {
  const current = browser.runtime.getManifest().version;
  const fromParam = new URLSearchParams(location.search).get("from");

  const changelog: ChangelogEntry[] = await fetch(browser.runtime.getURL("/changelog.json")).then((res) =>
    res.json(),
  );

  // Only auto-select the query param's version if it's actually a known
  // entry — selectVisibleEntries() already falls back to "from the
  // beginning" for an unrecognized/missing from, so the dropdown's initial
  // selection mirrors that same fallback rather than showing a param value
  // that wouldn't have had any effect anyway.
  const initialFrom = fromParam != null && changelog.some((e) => e.version === fromParam) ? fromParam : null;

  const select = renderFromSelect(changelog, initialFrom);
  renderList(selectVisibleEntries(changelog, current, initialFrom));

  select.addEventListener("change", () => {
    const from = select.value === "" ? null : select.value;
    renderList(selectVisibleEntries(changelog, current, from));
  });
}

void init();
