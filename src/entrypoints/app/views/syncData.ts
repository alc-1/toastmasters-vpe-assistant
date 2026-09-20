// src/entrypoints/app/views/syncData.ts
//
// The Sync Data view: a Basecamp card and an EasySpeak card, plus a
// completion summary once both imports are in. Reuses
// shared/sync-status-panel.ts's bindSourceEls/onScrapeClick/renderScrapeResult
// for the actual scrape trigger + response handling (unchanged) — this file
// only owns the card/badge/summary presentation layered on top of it.
//
// The Export menu is a daisyUI `dropdown` (open-on-focus, native blur to
// dismiss) — no JS, no document-level listener. This view therefore only
// registers the standard storage.onChanged listener inside its own root,
// like every other view. See shared/view.ts.

import { local, session } from "../../../shared/storage";
import { sendMessage } from "../../../shared/send-message";
import { getAnonymizeMode } from "../../../shared/settings-store";
import {
  bindSourceEls,
  loadMatchSummary,
  onScrapeClick,
  renderScrapeResult,
  type SourceEls,
} from "../../../shared/sync-status-panel";
import { countBasecampMembers, countClubCentralMembers, countEasySpeakMembers } from "../../../shared/sync/delta";
import { exportToExcel } from "../../../shared/export/export-to-excel";
import { EXPORT_OPTION_DESC, EXPORT_TYPE_LABEL, type ExportType } from "../../../shared/export/rows";
import { escapeHtml } from "../../../shared/dom-utils";
import type { BasecampOverviewScrape, BasecampScrape, ClubCentralScrape, EasySpeakScrape, SourceKey } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

function shellHtml(): string {
  return `
  <div class="page-intro page-intro--with-actions">
    <div class="page-intro__text">
      <h1 class="page-title">${escapeHtml(i18n.t("syncDataView.page.title.title"))}</h1>
      <p class="page-intro__desc">${escapeHtml(i18n.t("syncDataView.page.intro.body"))}</p>
    </div>
    <div class="dropdown dropdown-end shrink-0">
      <button id="exportMenuBtn" tabindex="0" class="btn btn-secondary btn-sm" type="button">
        ${escapeHtml(i18n.t("syncDataView.export.menu.button"))} <span class="text-[10px]" aria-hidden="true">▾</span>
      </button>
      <div id="exportPopover" tabindex="0"
           class="dropdown-content z-20 mt-2 w-[300px] max-w-[calc(100vw-2rem)] rounded-md border border-base-300 bg-base-100 p-4 shadow-lg">
        <div class="text-sm font-semibold mb-2">${escapeHtml(i18n.t("syncDataView.export.popover.title"))}</div>
        <p class="help-text">${escapeHtml(i18n.t("syncDataView.export.popover.help"))}</p>
        <div id="exportOptionsRoot" class="export-options"></div>
        <p id="anonymizeExportNotice" class="help-text" aria-live="polite"></p>
        <button id="exportExcelBtn" class="btn btn-primary btn-sm w-full" disabled>${escapeHtml(i18n.t("syncDataView.export.action.button"))}</button>
        <p id="statusExport" class="help-text" aria-live="polite"></p>
      </div>
    </div>
  </div>

  <div class="sync-cards">
    <div class="card sync-card">
      <div class="card-header sync-card__header">
        <span class="sync-card__title">${escapeHtml(i18n.t("syncDataView.card.clubCentral.title"))}</span>
        <span id="badgeClubCentral" class="badge badge-soft badge-error">${escapeHtml(i18n.t("syncDataView.badge.notImported.label"))}</span>
      </div>
      <div class="card-body sync-card__body">
        <p id="statusClubCentral" class="sync-card__status-text help-text" aria-live="polite"></p>
        <div id="metaClubCentral" class="sync-card__result"></div>
        <button id="scrapeClubCentralBtn" class="btn btn-primary sync-card__action">
          <span class="sync-card__action-label">${escapeHtml(i18n.t("syncDataView.card.action.importClubCentral.button"))}</span>
          <span class="sync-card__action-sublabel">${escapeHtml(i18n.t("syncDataView.card.action.importClubCentral.sublabel"))}</span>
        </button>
        <details id="detailsClubCentral" class="sync-card__details" hidden>
          <summary>${escapeHtml(i18n.t("syncDataView.card.viewDetails.label"))}</summary>
          <div id="summaryClubCentral" class="summary"></div>
          <pre id="rawDataClubCentral" class="raw-data"></pre>
        </details>
      </div>
    </div>

    <div class="card sync-card">
      <div class="card-header sync-card__header">
        <span class="sync-card__title">${escapeHtml(i18n.t("export.type.basecamp.label"))}</span>
        <span id="badgeBasecamp" class="badge badge-soft badge-error">${escapeHtml(i18n.t("syncDataView.badge.notImported.label"))}</span>
      </div>
      <div class="card-body sync-card__body">
        <p id="statusBasecamp" class="sync-card__status-text help-text" aria-live="polite"></p>
        <p id="progressBasecamp" class="sync-card__status-text help-text" aria-live="polite"></p>
        <div id="metaBasecamp" class="sync-card__result"></div>
        <button id="scrapeBasecampBtn" class="btn btn-primary sync-card__action">
          <span class="sync-card__action-label">${escapeHtml(i18n.t("syncDataView.card.action.importBasecamp.button"))}</span>
          <span class="sync-card__action-sublabel">${escapeHtml(i18n.t("syncDataView.card.action.importBasecamp.sublabel"))}</span>
        </button>
        <details id="detailsBasecamp" class="sync-card__details" hidden>
          <summary>${escapeHtml(i18n.t("syncDataView.card.viewDetails.label"))}</summary>
          <div id="summaryBasecamp" class="summary"></div>
          <pre id="rawDataBasecamp" class="raw-data"></pre>
        </details>
      </div>
    </div>

    <div class="card sync-card">
      <div class="card-header sync-card__header">
        <span class="sync-card__title">${escapeHtml(i18n.t("export.type.easyspeak.label"))}</span>
        <span id="badgeEasySpeak" class="badge badge-soft badge-error">${escapeHtml(i18n.t("syncDataView.badge.notImported.label"))}</span>
      </div>
      <div class="card-body sync-card__body">
        <p id="statusEasySpeak" class="sync-card__status-text help-text" aria-live="polite"></p>
        <div id="metaEasySpeak" class="sync-card__result"></div>
        <button id="scrapeEasySpeakBtn" class="btn btn-primary sync-card__action">
          <span class="sync-card__action-label">${escapeHtml(i18n.t("syncDataView.card.action.importEasyspeak.button"))}</span>
          <span class="sync-card__action-sublabel">${escapeHtml(i18n.t("syncDataView.card.action.importEasyspeak.sublabel"))}</span>
        </button>
        <details id="detailsEasySpeak" class="sync-card__details" hidden>
          <summary>${escapeHtml(i18n.t("syncDataView.card.viewDetails.label"))}</summary>
          <div id="summaryEasySpeak" class="summary"></div>
          <pre id="rawDataEasySpeak" class="raw-data"></pre>
        </details>
      </div>
    </div>
  </div>

  <div id="completionSummary" class="setup-summary" hidden></div>

  <p id="continueHelper" class="help-text step-continue-helper"></p>
`;
}

type BadgeTone = "danger" | "pending" | "success";

function badgeLabel(tone: BadgeTone): string {
  return i18n.t(
    tone === "danger"
      ? "syncDataView.badge.notImported.label"
      : tone === "pending"
        ? "syncDataView.badge.importing.label"
        : "syncDataView.badge.imported.label",
  );
}

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  danger: "badge-error",
  pending: "badge-warning",
  success: "badge-success",
};

function computeExportAvailability(basecampData: BasecampScrape | null, easyspeakData: EasySpeakScrape | null): Record<ExportType, boolean> {
  const hasBasecamp = !!basecampData;
  const hasEasySpeak = !!easyspeakData;
  return { all: hasBasecamp && hasEasySpeak, basecamp: hasBasecamp, easyspeak: hasEasySpeak };
}

function setBadge(el: HTMLElement, tone: BadgeTone) {
  el.className = `badge badge-soft ${BADGE_TONE_CLASS[tone]}`;
  el.textContent = badgeLabel(tone);
}

// Full date + time, in the browser's own locale (no explicit locale arg —
// same as shared/sync-status-panel.ts's formatDate) — just with a "just now"
// fallback for a missing timestamp instead of that function's "never" (this
// view only ever calls it once a source's data is actually present).
function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return i18n.t("syncDataView.card.time.justNow.label");
  return new Date(timestamp).toLocaleString();
}

export const syncDataView: ViewModule = {
  async mount(root) {
    root.innerHTML = shellHtml();

    // Set true by the disposer. refresh() has several await points (a
    // background message round-trip, storage reads, buildReport()) — if
    // the user navigates away while one is in flight, the shell replaces
    // #viewRoot's content with a different view before this promise chain
    // resumes; without this guard the resumed code would go on writing
    // into elements (queried fresh via document.getElementById, matching
    // this view's own ids) that either don't exist in the new view at all
    // (a null-dereference crash) or — worse — happen to collide with an id
    // the new view *does* use, silently corrupting its DOM instead.
    let disposed = false;

    const basecampEls: SourceEls = bindSourceEls({ btn: "scrapeBasecampBtn", status: "statusBasecamp", summary: "summaryBasecamp", rawData: "rawDataBasecamp" });
    const easyspeakEls: SourceEls = bindSourceEls({ btn: "scrapeEasySpeakBtn", status: "statusEasySpeak", summary: "summaryEasySpeak", rawData: "rawDataEasySpeak" });
    const clubCentralEls: SourceEls = bindSourceEls({ btn: "scrapeClubCentralBtn", status: "statusClubCentral", summary: "summaryClubCentral", rawData: "rawDataClubCentral" });

    const badgeBasecamp = document.getElementById("badgeBasecamp")!;
    const progressBasecamp = document.getElementById("progressBasecamp")!;
    const metaBasecamp = document.getElementById("metaBasecamp")!;
    const detailsBasecamp = document.getElementById("detailsBasecamp") as HTMLDetailsElement;
    const badgeEasySpeak = document.getElementById("badgeEasySpeak")!;
    const metaEasySpeak = document.getElementById("metaEasySpeak")!;
    const detailsEasySpeak = document.getElementById("detailsEasySpeak") as HTMLDetailsElement;
    const badgeClubCentral = document.getElementById("badgeClubCentral")!;
    const metaClubCentral = document.getElementById("metaClubCentral")!;
    const detailsClubCentral = document.getElementById("detailsClubCentral") as HTMLDetailsElement;
    const completionSummary = document.getElementById("completionSummary")!;
    const continueHelper = document.getElementById("continueHelper")!;

    // Set once an Import/Re-import button is actually clicked during this
    // mount — the completion summary below is gated on this (not just on
    // both sources having data), so simply revisiting the view with
    // already-imported data doesn't show it again.
    let importActionOccurred = false;

    basecampEls.btn.addEventListener("click", async () => {
      setBadge(badgeBasecamp, "pending");
      const anonymize = await getAnonymizeMode();
      await onScrapeClick<BasecampScrape>({
        els: basecampEls,
        message: { type: "SCRAPE_BASECAMP" },
        loadingLabel: i18n.t("syncDataView.card.action.importing.label"),
        render: (els, data) => renderScrapeResult(els, data, "basecamp", anonymize),
      });
      importActionOccurred = true;
      await refresh();
    });

    easyspeakEls.btn.addEventListener("click", async () => {
      setBadge(badgeEasySpeak, "pending");
      const anonymize = await getAnonymizeMode();
      await onScrapeClick<EasySpeakScrape>({
        els: easyspeakEls,
        message: { type: "SCRAPE_EASYSPEAK" },
        loadingLabel: i18n.t("syncDataView.card.action.importing.label"),
        render: (els, data) => renderScrapeResult(els, data, "easyspeak", anonymize),
      });
      importActionOccurred = true;
      await refresh();
    });

    clubCentralEls.btn.addEventListener("click", async () => {
      setBadge(badgeClubCentral, "pending");
      const anonymize = await getAnonymizeMode();
      await onScrapeClick<ClubCentralScrape>({
        els: clubCentralEls,
        message: { type: "SCRAPE_CLUBCENTRAL" },
        loadingLabel: i18n.t("syncDataView.card.action.importing.label"),
        render: (els, data) => renderScrapeResult(els, data, "clubcentral", anonymize),
      });
      importActionOccurred = true;
      await refresh();
    });

    const exportBtn = document.getElementById("exportExcelBtn") as HTMLButtonElement;
    const statusExport = document.getElementById("statusExport")!;
    const exportIdleLabel = exportBtn.textContent ?? "";

    // The Export menu is a daisyUI `dropdown` — open on focus, native
    // click-outside (blur) close, no JS and no document-level listener.

    // Which export type is currently selected in the Export card's
    // radio-style selector. null only while neither Basecamp nor EasySpeak
    // data is loaded yet (nothing to export). Persists across refresh()
    // calls so a manual pick survives storage-change-triggered re-renders,
    // unless that pick becomes unavailable — see refresh() below.
    let selectedExportType: ExportType | null = null;

    // True only once the user has actually clicked an option themselves.
    // Distinguishes a deliberate choice (never silently overridden again)
    // from an automatic fallback pick — refresh() upgrades the latter to
    // "all" the moment it becomes available.
    let exportTypeUserPicked = false;

    function updateExportButtonState() {
      exportBtn.disabled = selectedExportType === null;
    }

    function renderExportOptions(availability: Record<ExportType, boolean>) {
      const optionsRoot = document.getElementById("exportOptionsRoot")!;
      optionsRoot.innerHTML = (["all", "basecamp", "easyspeak"] as ExportType[])
        .map((type) => {
          const enabled = availability[type];
          const selected = selectedExportType === type;
          return `
            <label class="option-card${selected ? " selected" : ""}${enabled ? "" : " disabled"}">
              <input type="radio" name="exportType" value="${type}"${selected ? " checked" : ""}${enabled ? "" : " disabled"}>
              <span class="option-card__body">
                <span class="option-card__title">${EXPORT_TYPE_LABEL[type]}</span>
                <span class="option-card__desc">${EXPORT_OPTION_DESC[type]}</span>
              </span>
            </label>
          `;
        })
        .join("");

      optionsRoot.querySelectorAll<HTMLInputElement>('input[name="exportType"]').forEach((input) => {
        input.addEventListener("change", () => {
          selectedExportType = input.value as ExportType;
          exportTypeUserPicked = true;
          // Toggle the .selected class in place rather than re-rendering the
          // whole list — a full innerHTML rebuild would blow away the focused
          // radio and collapse the daisyUI (focus-based) dropdown.
          optionsRoot.querySelectorAll<HTMLElement>(".option-card").forEach((card) => {
            card.classList.toggle("selected", card.querySelector<HTMLInputElement>("input")?.value === input.value);
          });
          updateExportButtonState();
        });
      });

      updateExportButtonState();
    }

    let exporting = false;
    exportBtn.addEventListener("click", async () => {
      if (!selectedExportType || exporting) return;
      // Don't toggle `disabled` — that would blur the button and collapse the
      // daisyUI dropdown mid-export, hiding the status line below. A re-entrancy
      // flag + label change is enough.
      exporting = true;
      exportBtn.setAttribute("aria-busy", "true");
      exportBtn.textContent = i18n.t("syncDataView.export.action.generating");
      statusExport.textContent = "";
      try {
        const summary = await exportToExcel(selectedExportType);
        statusExport.innerHTML = i18n.t("syncDataView.export.status.exported.sentence", [`<ins>${escapeHtml(summary.filename)}</ins>`]);
      } catch (err) {
        statusExport.textContent = i18n.t("syncDataView.export.status.failed.error", [
          err instanceof Error ? err.message : String(err),
        ]);
      } finally {
        exporting = false;
        exportBtn.removeAttribute("aria-busy");
        exportBtn.textContent = exportIdleLabel;
        updateExportButtonState();
      }
    });

    // refresh() is triggered from two independent places: explicitly, right
    // after a scrape's onScrapeClick() resolves, and by the storage.onChanged
    // listener below, which fires the instant a scrape writes its data to
    // browser.storage.local — which happens *before* background/messaging.ts's
    // runScrape() flips the source's icon status to "success" and responds.
    // That means two overlapping refresh() calls can resolve out of order —
    // refreshToken guards against a stale one winning. See sync-data's
    // original header comment (preserved in git history) for the full
    // race-condition writeup this guards against.
    let refreshToken = 0;

    async function refresh() {
      const myToken = ++refreshToken;

      // A dropped response (e.g. Firefox's message-port teardown quirk — see
      // background/messaging.ts) must never break this view's render, so a
      // rejection falls back to the same "idle" default a falsy response
      // already does.
      const statuses = (await sendMessage({ type: "POPUP_OPENED" }).catch(() => null)) || { basecamp: "idle", easyspeak: "idle", clubcentral: "idle" };
      const cached = await local.get([
        "basecampData",
        "basecampScrapedAt",
        "basecampCompletedPaths",
        "easyspeakData",
        "easyspeakScrapedAt",
        "clubCentralData",
        "clubCentralScrapedAt",
      ]);

      if (disposed || myToken !== refreshToken) return; // this view was navigated away from, or a newer refresh() has since started — this one is stale

      const basecampLoading = statuses.basecamp === "loading" && !cached.basecampData;
      const easyspeakLoading = statuses.easyspeak === "loading" && !cached.easyspeakData;
      const clubCentralLoading = statuses.clubcentral === "loading" && !cached.clubCentralData;

      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      renderSourceCard(basecampEls, badgeBasecamp, metaBasecamp, detailsBasecamp, i18n.t("syncDataView.card.action.importBasecamp.button"), cached.basecampData ?? null, cached.basecampScrapedAt, basecampLoading, countBasecampMembers, "basecamp", anonymize);
      renderSourceCard(easyspeakEls, badgeEasySpeak, metaEasySpeak, detailsEasySpeak, i18n.t("syncDataView.card.action.importEasyspeak.button"), cached.easyspeakData ?? null, cached.easyspeakScrapedAt, easyspeakLoading, countEasySpeakMembers, "easyspeak", anonymize);
      renderSourceCard(clubCentralEls, badgeClubCentral, metaClubCentral, detailsClubCentral, i18n.t("syncDataView.card.action.importClubCentral.button"), cached.clubCentralData ?? null, cached.clubCentralScrapedAt, clubCentralLoading, countClubCentralMembers, "clubcentral", anonymize);
      document.getElementById("anonymizeExportNotice")!.textContent = anonymize ? i18n.t("syncDataView.export.notice.privacyModeOn.body") : "";
      await renderProgress();
      if (disposed) return;

      const exportAvailability = computeExportAvailability(cached.basecampData ?? null, cached.easyspeakData ?? null);
      if (!selectedExportType || !exportAvailability[selectedExportType]) {
        selectedExportType = (["all", "basecamp", "easyspeak"] as ExportType[]).find((t) => exportAvailability[t]) ?? null;
        exportTypeUserPicked = false;
      } else if (!exportTypeUserPicked && exportAvailability.all && selectedExportType !== "all") {
        selectedExportType = "all";
      }
      renderExportOptions(exportAvailability);

      await renderCompletionSummary(cached.basecampData ?? null, cached.easyspeakData ?? null, cached.basecampCompletedPaths ?? {});
      if (disposed) return;

      const hasBoth = !!cached.basecampData && !!cached.easyspeakData;
      continueHelper.textContent = hasBoth ? "" : i18n.t("syncDataView.continueHelper.needsBothSources.body");
    }

    async function renderProgress() {
      const state = await session.value("scrapeProgress");
      const progress = state?.basecamp;
      if (!progress) {
        progressBasecamp.textContent = "";
        return;
      }
      const clubLabel = i18n.t("syncDataView.progress.club.sentence", [
        String(progress.currentClubIndex),
        String(progress.clubsTotal),
        progress.currentClubName,
      ]);
      progressBasecamp.textContent =
        progress.currentClubMembersTotal === null
          ? i18n.t("syncDataView.progress.starting.sentence", [clubLabel])
          : i18n.t("syncDataView.progress.membersLoaded.count", progress.currentClubMembersFetched, [
              clubLabel,
              String(progress.currentClubMembersFetched),
              String(progress.currentClubMembersTotal),
            ]);
    }

    function renderSourceCard<T extends BasecampScrape | EasySpeakScrape | ClubCentralScrape>(
      els: SourceEls,
      badge: HTMLElement,
      result: HTMLElement,
      details: HTMLDetailsElement,
      idleLabel: string,
      data: T | null,
      scrapedAt: number | undefined,
      isLoading: boolean,
      countMembers: (data: T) => number,
      source: SourceKey,
      anonymize: boolean
    ) {
      if (isLoading) {
        setBadge(badge, "pending");
        els.btn.className = "btn btn-primary sync-card__action";
        els.btn.disabled = true;
        els.btnLabel.textContent = i18n.t("syncDataView.card.action.importing.label");
        details.hidden = true;
        return;
      }

      els.btn.disabled = false;

      if (data) {
        setBadge(badge, "success");
        els.btn.className = "btn btn-secondary sync-card__action";
        els.btnLabel.textContent = i18n.t("syncDataView.card.action.reimport.button");
        const count = countMembers(data);
        result.innerHTML = `<div>${escapeHtml(i18n.t("syncDataView.card.result.imported.count", count, [formatTime(scrapedAt), String(count)]))}</div>`;
        els.status.textContent = "";
        details.hidden = false;
        renderScrapeResult(els, data, source, anonymize);
      } else {
        setBadge(badge, "danger");
        els.btn.className = "btn btn-primary sync-card__action";
        els.btnLabel.textContent = idleLabel;
        result.innerHTML = "";
        els.status.textContent = "";
        details.hidden = true;
      }
    }

    async function renderCompletionSummary(
      basecampData: BasecampScrape | null,
      easyspeakData: EasySpeakScrape | null,
      basecampCompletedPaths: BasecampOverviewScrape = {}
    ) {
      if (!importActionOccurred || !basecampData || !easyspeakData) {
        completionSummary.hidden = true;
        return;
      }

      const { matched, total } = await loadMatchSummary(basecampData, easyspeakData, basecampCompletedPaths);
      const basecampCount = countBasecampMembers(basecampData);
      const easyspeakCount = countEasySpeakMembers(easyspeakData);
      const needsReview = total - matched;

      completionSummary.hidden = false;
      completionSummary.innerHTML = `
        <div class="setup-summary__title sync-summary-title">
          <span>${escapeHtml(i18n.t("syncDataView.summary.title.label"))}</span>
          <span class="sync-summary-check">✓</span>
        </div>
        <div class="setup-summary__stats">
          <div class="setup-summary__item">${escapeHtml(i18n.t("syncDataView.summary.basecamp.count", basecampCount))}</div>
          <div class="setup-summary__item">${escapeHtml(i18n.t("syncDataView.summary.easyspeak.count", easyspeakCount))}</div>
          <div class="setup-summary__item">${escapeHtml(i18n.t("syncDataView.summary.matched.count", matched))}</div>
          <div class="setup-summary__item">${escapeHtml(i18n.t("syncDataView.summary.needsReview.count", needsReview))}</div>
        </div>
        <p class="setup-summary__footer">${escapeHtml(i18n.t("syncDataView.summary.footer.label"))}</p>
      `;
    }

    // Keeps this view in sync if a scrape started elsewhere (e.g. another
    // tab) finishes while this one stays mounted. Session-area changes are
    // handled separately (renderProgress alone, not a full refresh()) since
    // those fire once per page fetched during a Basecamp import.
    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local") refresh();
      else if (area === "session" && changes.scrapeProgress) renderProgress();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await refresh();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
