// src/entrypoints/app/views/whatsNew.ts
//
// The What's New view (#whatsNew) — moved into the merged app from its own
// former standalone entrypoint (entrypoints/whats-new/). Opened by
// entrypoints/background.ts's onInstalled("update") handler as
// app.html?from=<previousVersion>#whatsNew, by the popup's "What's New"
// footer link (no query string — every entry shown), or from the Home
// dashboard's "What's New" feature tile.
//
// Content comes from changelog.json, bundled into every build at build time
// from CHANGELOG.md (see scripts/generate-changelog-json.ts) — not fetched
// from anywhere at runtime, so this works offline and always matches the
// build it's inside. No browser.storage dependency: which entries to show is
// derived entirely from the current manifest version + the "since" version
// (the ?from= query param initially, then whatever the dropdown is set to),
// via shared/whats-new-filter.ts's selectVisibleEntries().
//
// Standalone route, never gated (see entrypoints/app/router.ts). The shared
// header's "← Back to Home" link (main.ts passes showBackToHome for every
// non-dashboard route) is this view's path back to the hub.

import { escapeAttr, escapeHtml } from "../../../shared/dom-utils";
import { selectVisibleEntries } from "../../../shared/whats-new-filter";
import type { ChangelogEntry } from "../../../shared/whats-new-types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">What's New</h1>
    <p class="page-intro__desc">Notable changes to the extension.</p>
  </div>

  <div id="whatsNewFromRoot" class="whats-new__from"></div>
  <div id="whatsNewListRoot"></div>
`;

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

function renderList(listRoot: Element, entries: ChangelogEntry[]): void {
  listRoot.innerHTML = entries.length
    ? entries.map(renderEntry).join("")
    : `<p class="help-text">No changelog entries available for this version.</p>`;
}

// `changelog` is newest-first already (see scripts/changelog.ts's
// parseChangelog) — reused as-is for the dropdown's option order, "From the
// beginning" pinned above it as the empty-value default option.
function renderFromSelect(fromRoot: Element, changelog: ChangelogEntry[], selected: string | null): HTMLSelectElement {
  const options = [
    `<option value="">From the beginning</option>`,
    ...changelog.map((e) => `<option value="${escapeAttr(e.version)}">Since v${escapeHtml(e.version)}</option>`),
  ].join("");

  fromRoot.innerHTML = `
    <label class="whats-new__from-label" for="whatsNewFromSelect">Show changes</label>
    <select id="whatsNewFromSelect" class="select select-sm">${options}</select>
  `;

  const select = fromRoot.querySelector("#whatsNewFromSelect") as HTMLSelectElement;
  select.value = selected ?? "";
  return select;
}

export const whatsNewView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // See syncData.ts's mount() for the disposed-guard rationale.
    let disposed = false;

    const fromRoot = root.querySelector("#whatsNewFromRoot")!;
    const listRoot = root.querySelector("#whatsNewListRoot")!;

    const current = browser.runtime.getManifest().version;
    const fromParam = new URLSearchParams(location.search).get("from");

    // The ?from= param (set by background.ts's post-update tab open) is a
    // one-shot: consume it, then strip it from the URL so navigating back
    // here later in the same tab starts from "the beginning" rather than
    // silently keeping the old post-update filter.
    if (location.search) history.replaceState(null, "", `${location.pathname}${location.hash}`);

    const changelog: ChangelogEntry[] = await fetch(browser.runtime.getURL("/changelog.json")).then((res) => res.json());
    if (disposed) return () => {};

    // Only auto-select the query param's version if it's actually a known
    // entry — selectVisibleEntries() already falls back to "from the
    // beginning" for an unrecognized/missing from, so the dropdown's initial
    // selection mirrors that same fallback rather than showing a param value
    // that wouldn't have had any effect anyway.
    const initialFrom = fromParam != null && changelog.some((e) => e.version === fromParam) ? fromParam : null;

    const select = renderFromSelect(fromRoot, changelog, initialFrom);
    renderList(listRoot, selectVisibleEntries(changelog, current, initialFrom));

    const onChange = () => {
      const from = select.value === "" ? null : select.value;
      renderList(listRoot, selectVisibleEntries(changelog, current, from));
    };
    select.addEventListener("change", onChange);

    return () => {
      disposed = true;
      select.removeEventListener("change", onChange);
    };
  },
};
