// src/entrypoints/app/views/levelApproval.ts
//
// Level Approval Helper — lists the BCM's pending "Level" approval requests
// (background/api/basecamp.ts's fetchPendingLevelRequests(), stored as
// basecampPendingLevelRequests alongside basecampData/basecampScrapedAt).
// Account-wide, not club-scoped (the source endpoint carries no club id), so
// unlike onboarding.ts this renders one flat table rather than per-club
// cards — oldest request first, since that's the one that's waited longest.
//
// Reached from the Home dashboard's feature grid (#levelApproval). Gated by
// entrypoints/app/router.ts the same way #report/#exporter are (redirected
// to the dashboard until Basecamp data is imported) — unlike #onboarding,
// this data comes from the same Basecamp scrape those two already require.
//
// Same ViewModule lifecycle every other view follows — see shared/view.ts
// and syncData.ts's mount() for the disposed-guard rationale.

import { anonymizePendingLevelRequests } from "../../../shared/anonymize";
import { escapeHtml } from "../../../shared/dom-utils";
import { getAnonymizeMode } from "../../../shared/settings-store";
import { local } from "../../../shared/storage";
import type { BasecampPendingLevelRequest } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

function shellHtml(): string {
  return `
  <div class="page-intro">
    <h1 class="page-title">${escapeHtml(i18n.t("levelApproval.page.title.title"))}</h1>
    <p class="page-intro__desc">
      ${escapeHtml(i18n.t("levelApproval.page.intro.body"))}
    </p>
  </div>
  <p id="levelApprovalAnonymizeNotice" class="help-text" aria-live="polite"></p>
  <div id="levelApprovalRoot"></div>
`;
}

function formatDate(iso: string): string {
  if (!iso) return emptyCellHtml();
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? emptyCellHtml() : escapeHtml(parsed.toLocaleDateString());
}

function emptyCellHtml(): string {
  return `<span class="muted-text">${escapeHtml(i18n.t("onboarding.cell.empty.label"))}</span>`;
}

function renderRow(r: BasecampPendingLevelRequest): string {
  return `
    <tr>
      <td>${escapeHtml(r.requesterName)}</td>
      <td>${escapeHtml(r.courseDisplayName)}</td>
      <td>${r.levelNumber != null ? escapeHtml(String(r.levelNumber)) : emptyCellHtml()}</td>
      <td>${formatDate(r.created)}</td>
      <td>${formatDate(r.modified)}</td>
    </tr>`;
}

function renderTable(requests: BasecampPendingLevelRequest[]): string {
  const count = requests.length;
  return `
    <div class="card">
      <div class="card-header">
        <span class="card-header__title">${escapeHtml(i18n.t("levelApproval.card.title.title"))}</span>
        <span class="badge badge-soft badge-neutral">${escapeHtml(i18n.t("levelApproval.card.requestCount.count", count))}</span>
      </div>
      <div class="card-body">
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead><tr>
              <th>${escapeHtml(i18n.t("levelApproval.table.requester.label"))}</th>
              <th>${escapeHtml(i18n.t("levelApproval.table.path.label"))}</th>
              <th>${escapeHtml(i18n.t("levelApproval.table.level.label"))}</th>
              <th>${escapeHtml(i18n.t("levelApproval.table.submitted.label"))}</th>
              <th>${escapeHtml(i18n.t("levelApproval.table.updated.label"))}</th>
            </tr></thead>
            <tbody>${requests.map(renderRow).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

export const levelApprovalView: ViewModule = {
  async mount(root) {
    root.innerHTML = shellHtml();

    let disposed = false;

    const notice = root.querySelector("#levelApprovalAnonymizeNotice")!;
    const listRoot = root.querySelector("#levelApprovalRoot")!;

    async function load() {
      const [cached, anonymize] = await Promise.all([
        local.get(["basecampPendingLevelRequests"]),
        getAnonymizeMode(),
      ]);
      if (disposed) return;

      notice.textContent = anonymize ? i18n.t("levelApproval.notice.privacyModeOn.body") : "";

      const raw = cached.basecampPendingLevelRequests ?? null;
      if (raw === null) {
        listRoot.innerHTML = `<p class="empty-state">${i18n.t("levelApproval.emptyState.noData.sentence")}</p>`;
        return;
      }
      if (raw.length === 0) {
        listRoot.innerHTML = `<p class="empty-state">${escapeHtml(i18n.t("levelApproval.emptyState.allDone.body"))}</p>`;
        return;
      }

      const requests = [...(anonymize ? anonymizePendingLevelRequests(raw) : raw)].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
      );
      listRoot.innerHTML = renderTable(requests);
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") void load();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await load();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
