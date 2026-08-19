// src/entrypoints/app/views/clubReview.ts
//
// The Club Review view: club-name lookup, a review table (every club from
// both sources, not just already-pinned ones), same shape/vocabulary as
// members.ts's member-matching table — a status badge per club pair
// (Exact/Suggested/Linked manually/Unmatched) and Confirm/"Not this
// one"/Unlink actions.

import { escapeAttr, escapeHtml } from "../../../shared/dom-utils";
import { local } from "../../../shared/storage";
import { getClubLookup, getClubRejectedPairs, pinClub, rejectClubPair, removeClubPin } from "../../../shared/resolution-store";
import { matchClubs, type ClubGroup, type ClubMatchPair } from "../../../shared/sync/conflicts";
import { getAnonymizeMode } from "../../../shared/settings-store";
import type { BasecampScrape, EasySpeakScrape } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <h1 class="page-title">Club Review</h1>

  <div class="card">
    <div class="card-header"><span class="card-header__title">Club name lookup</span></div>
    <div class="card-body">
      <p class="help-text">
        Pins a Basecamp club to an EasySpeak club regardless of how similar their names are.
        Suggested matches based on name similarity can be confirmed or rejected below.
      </p>
      <div id="clubLookupRoot"></div>
    </div>
  </div>
`;

type ClubPair = ClubMatchPair<ClubGroup<unknown>, ClubGroup<unknown>>;

export const clubReviewView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // Set true by the disposer — see syncData.ts's mount() for the full
    // writeup of why an in-flight async refresh needs this guard.
    let disposed = false;

    let basecampData: BasecampScrape | null = null;
    let easyspeakData: EasySpeakScrape | null = null;

    async function computeClubMatches(): Promise<ClubPair[]> {
      if (!basecampData || !easyspeakData) return [];
      const clubLookup = await getClubLookup();
      const clubRejectedPairs = await getClubRejectedPairs();
      const bcClubs: ClubGroup<unknown>[] = Object.entries(basecampData).map(([id, club]) => ({ id, name: club.name, people: [] }));
      const esClubs: ClubGroup<unknown>[] = Object.entries(easyspeakData).map(([id, club]) => ({ id, name: club.name, people: [] }));
      // allowFuzzy: true — unlike buildReport()'s own matchClubs() call
      // (which never surfaces an unconfirmed guess), this is the one place
      // a fuzzy suggestion is meant to be reviewed.
      return matchClubs(bcClubs, esClubs, clubLookup, clubRejectedPairs, true);
    }

    function needsClubAction(pair: ClubPair): boolean {
      return pair.confidence === "fuzzy" || !pair.basecamp || !pair.easyspeak;
    }

    function clubSortName(pair: ClubPair): string {
      return String(pair.basecamp?.name ?? pair.easyspeak?.name ?? "");
    }

    function sortClubPairs(pairs: ClubPair[]): ClubPair[] {
      return [...pairs].sort((a, b) => clubSortName(a).localeCompare(clubSortName(b), undefined, { sensitivity: "base" }));
    }

    // Split into two groups rather than one combined table: linked clubs
    // (nothing to do) rendered first, unmatched/suggested clubs (action
    // required) rendered last, directly above the manual mapping form —
    // that ordering puts the thing a reviewer needs to act on right next to
    // the tool they'd use to act on it.
    function renderClubLookupSection(matches: ClubPair[]): string {
      if (!basecampData || !easyspeakData) {
        return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to review club matches.</p>';
      }
      if (matches.length === 0) {
        return '<p class="empty-state">No clubs found in either data source.</p>';
      }

      const linked = sortClubPairs(matches.filter((m) => !needsClubAction(m)));
      const unmatched = sortClubPairs(matches.filter(needsClubAction));

      const linkedSection = linked.length
        ? `<h2 class="section-header section-header--first">Linked Clubs</h2><div class="table-scroll">${renderClubTable(linked)}</div>`
        : "";

      const unmatchedSection = unmatched.length
        ? `
            <h2 class="section-header${linked.length ? "" : " section-header--first"}">Unmatched Clubs</h2>
            <p class="help-text">These clubs need a decision — confirm or reject a suggested match, or use the form below to pin one manually.</p>
            <div class="table-scroll">${renderClubTable(unmatched)}</div>
          `
        : "";

      // Heading ties the form below back to the unmatched cards above it,
      // so it doesn't read as an unrelated "add a club" feature.
      const addFormSection = `<h2 class="section-header">Link Unmatched Clubs</h2>${renderClubAddForm(matches)}`;

      return `${linkedSection}${unmatchedSection}${addFormSection}`;
    }

    function renderClubTable(pairs: ClubPair[]): string {
      const rows = pairs.map(renderClubMatchRow).join("");
      return `<table class="data-table lookup"><thead><tr><th>Basecamp club</th><th>EasySpeak club</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function renderClubMatchRow(pair: ClubPair): string {
      return `
        <tr>
          <td data-label="Basecamp">${pair.basecamp ? escapeHtml(pair.basecamp.name) : '<span class="muted-text">—</span>'}</td>
          <td data-label="EasySpeak">${pair.easyspeak ? escapeHtml(pair.easyspeak.name) : '<span class="muted-text">—</span>'}</td>
          <td>${renderClubStatusCell(pair)}</td>
          <td class="actions">${renderClubActionsCell(pair)}</td>
        </tr>
      `;
    }

    function renderClubStatusCell(pair: ClubPair): string {
      if (!pair.basecamp || !pair.easyspeak) return '<span class="badge badge-unmatched">Unmatched</span>';
      if (pair.confidence === "confirmed") {
        const sourceLabel = pair.source === "manual-search" ? "linked via manual search" : "confirmed from a suggested match";
        return `<span class="badge badge-confirmed" title="${escapeAttr(sourceLabel)}">Linked manually</span>`;
      }
      if (pair.confidence === "fuzzy") {
        const score = pair.score != null ? pair.score.toFixed(2) : "—";
        return `<span class="badge badge-fuzzy" title="match score: ${score}">Suggested</span>`;
      }
      return '<span class="badge badge-exact">Exact</span>';
    }

    function renderClubActionsCell(pair: ClubPair): string {
      // No per-row instructions here — the Unmatched Clubs section above the
      // table already carries that guidance once, not once per row.
      if (!pair.basecamp || !pair.easyspeak) return "";

      const bcId = escapeAttr(pair.basecamp.id as string);
      const esId = escapeAttr(pair.easyspeak.id as string);

      if (pair.confidence === "fuzzy") {
        const bcName = escapeAttr(pair.basecamp.name as string);
        const esName = escapeAttr(pair.easyspeak.name as string);
        return (
          `<button class="btn btn-primary" data-action="confirm-club" data-bc-id="${bcId}" data-es-id="${esId}" data-bc-name="${bcName}" data-es-name="${esName}">Confirm</button>` +
          `<button class="btn btn-secondary" data-action="reject-club" data-bc-id="${bcId}" data-es-id="${esId}">Not this one</button>`
        );
      }

      const title =
        pair.confidence === "exact"
          ? "Excludes this pairing so it won't auto-match again, marking both clubs unmatched so you can pin the correct one manually."
          : "Removes this pin so the pairing can be re-matched or re-pinned.";
      return `<button class="btn btn-secondary" data-action="unlink-club" data-confidence="${escapeAttr(pair.confidence ?? "")}" data-bc-id="${bcId}" data-es-id="${esId}" title="${title}">Unlink</button>`;
    }

    function renderClubAddForm(matches: ClubPair[]): string {
      if (!basecampData || !easyspeakData) {
        return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to add a club pin.</p>';
      }

      const matchedBcIds = new Set(matches.filter((m) => m.basecamp && m.easyspeak).map((m) => m.basecamp!.id));
      const matchedEsIds = new Set(matches.filter((m) => m.basecamp && m.easyspeak).map((m) => m.easyspeak!.id));

      const bcOptions = Object.entries(basecampData)
        .filter(([id]) => !matchedBcIds.has(id))
        .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
        .join("");
      const esOptions = Object.entries(easyspeakData)
        .filter(([id]) => !matchedEsIds.has(id))
        .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
        .join("");

      if (!bcOptions || !esOptions) {
        return '<p class="empty-state">All clubs are already matched or pinned.</p>';
      }

      return `
        <div class="add-form">
          <select id="newClubPinBc" aria-label="Basecamp club">${bcOptions}</select>
          <span class="add-form-arrow add-form-arrow--wide">&harr;</span>
          <span class="add-form-arrow add-form-arrow--narrow">&darr;</span>
          <select id="newClubPinEs" aria-label="EasySpeak club">${esOptions}</select>
          <button class="btn btn-primary" data-action="add-club-pin">Add mapping</button>
        </div>
      `;
    }

    async function refreshClubLookup() {
      const matches = await computeClubMatches();
      if (disposed) return;
      root.querySelector("#clubLookupRoot")!.innerHTML = renderClubLookupSection(matches);
      attachClubLookupHandlers();
    }

    function attachClubLookupHandlers() {
      const lookupRoot = root.querySelector("#clubLookupRoot")!;
      lookupRoot.querySelectorAll<HTMLButtonElement>('[data-action="confirm-club"]').forEach((btn) => {
        btn.addEventListener("click", () => onConfirmClubPair(btn));
      });
      lookupRoot.querySelectorAll<HTMLButtonElement>('[data-action="reject-club"]').forEach((btn) => {
        btn.addEventListener("click", () => onRejectClubPair(btn));
      });
      lookupRoot.querySelectorAll<HTMLButtonElement>('[data-action="unlink-club"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnlinkClubPair(btn));
      });
      const addBtn = lookupRoot.querySelector<HTMLButtonElement>('[data-action="add-club-pin"]');
      if (addBtn) addBtn.addEventListener("click", onAddClubPin);
    }

    async function onConfirmClubPair(btn: HTMLButtonElement) {
      const { bcId, esId, bcName, esName } = btn.dataset;
      await pinClub(bcId!, esId!, bcName!, esName!, "fuzzy-confirmed");
      await refreshClubLookup();
    }

    async function onRejectClubPair(btn: HTMLButtonElement) {
      await rejectClubPair(btn.dataset.bcId!, btn.dataset.esId!);
      await refreshClubLookup();
    }

    async function onUnlinkClubPair(btn: HTMLButtonElement) {
      if (btn.dataset.confidence === "exact") {
        await rejectClubPair(btn.dataset.bcId!, btn.dataset.esId!);
      } else {
        await removeClubPin(btn.dataset.bcId!);
      }
      await refreshClubLookup();
    }

    async function onAddClubPin() {
      const bcId = (root.querySelector("#newClubPinBc") as HTMLSelectElement).value;
      const esId = (root.querySelector("#newClubPinEs") as HTMLSelectElement).value;
      const bcName = basecampData?.[bcId]?.name ?? bcId;
      const esName = easyspeakData?.[esId]?.name ?? esId;
      await pinClub(bcId, esId, bcName, esName, "manual-search");
      await refreshClubLookup();
    }

    async function init() {
      // Anonymize Mode replaces every real name with a generic label, so
      // name-based matching (this view's whole purpose) can't be done while
      // it's on.
      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      if (anonymize) {
        root.querySelector("#clubLookupRoot")!.innerHTML =
          '<p class="empty-state">Club Review is unavailable while Anonymize Mode is on. ' +
          '<a href="#globalSettings">Turn it off in Global Settings</a> to review club matches.</p>';
        return;
      }

      const cached = await local.get(["basecampData", "easyspeakData"]);
      if (disposed) return;
      basecampData = cached.basecampData ?? null;
      easyspeakData = cached.easyspeakData ?? null;

      await refreshClubLookup();
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") init();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await init();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
