// src/entrypoints/app/views/onboarding.ts
//
// Pathways Onboarding Helper — lists club members who are paid up but not
// yet enrolled in a Pathways path: exactly the people a VPE needs to reach
// out to and help get started. Sourced entirely from the Club Central
// roster (shared/types.ts's ClubCentralScrape) — it never touches
// basecampData/easyspeakData or buildReport().
//
// Reached from the Home dashboard's feature grid (#onboarding). Deliberately
// NOT gated by entrypoints/app/router.ts: Club Central is an independent
// source (unlike the Basecamp-backed #report/#exporter), so this view shows
// its own "import the roster first" empty state when clubCentralData is
// absent rather than redirecting to the dashboard.
//
// Same ViewModule lifecycle every other view follows — see shared/view.ts
// and syncData.ts's mount() for the disposed-guard rationale.

import { anonymizeClubCentralScrape } from "../../../shared/anonymize";
import { escapeHtml } from "../../../shared/dom-utils";
import { getAnonymizeMode } from "../../../shared/settings-store";
import { local } from "../../../shared/storage";
import type { ClubCentralMemberRow, ClubCentralScrape } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">Pathways Onboarding Helper</h1>
    <p class="page-intro__desc">
      Paid-up members who haven't enrolled in a Pathways path yet — the people to reach out to and help get started.
    </p>
  </div>
  <p id="onboardingAnonymizeNotice" class="help-text" aria-live="polite"></p>
  <div id="onboardingRoot"></div>
`;

interface ClubBucket {
  clubName: string;
  members: ClubCentralMemberRow[];
}

// Paid up (paymentStatus === "Paid" — "Membership Pending" doesn't count as
// a member you can actively onboard yet) and not yet in a path.
function collectNeedingOnboarding(data: ClubCentralScrape): ClubBucket[] {
  return Object.values(data)
    .map((club) => ({
      clubName: club.name,
      members: club.members
        .filter((m) => m.paymentStatus === "Paid" && !m.pathwaysEnrolled)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    }))
    .filter((bucket) => bucket.members.length > 0)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, undefined, { sensitivity: "base" }));
}

function renderBucket(bucket: ClubBucket): string {
  const rows = bucket.members
    .map(
      (m) => `
        <tr>
          <td>${escapeHtml(m.name)}</td>
          <td>${m.position ? escapeHtml(m.position) : '<span class="muted-text">—</span>'}</td>
          <td>${m.paidUntil ? escapeHtml(m.paidUntil) : '<span class="muted-text">—</span>'}</td>
        </tr>`
    )
    .join("");

  const count = bucket.members.length;
  return `
    <div class="card">
      <div class="card-header">
        <span class="card-header__title">${escapeHtml(bucket.clubName)}</span>
        <span class="badge badge-soft badge-warning">${count} to onboard</span>
      </div>
      <div class="card-body">
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Position</th><th>Paid through</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

export const onboardingView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    let disposed = false;

    const notice = root.querySelector("#onboardingAnonymizeNotice")!;
    const listRoot = root.querySelector("#onboardingRoot")!;

    async function render() {
      const [cached, anonymize] = await Promise.all([
        local.get(["clubCentralData"]),
        getAnonymizeMode(),
      ]);
      if (disposed) return;

      notice.textContent = anonymize ? "Privacy Mode is on — member names are anonymized." : "";

      const raw = cached.clubCentralData ?? null;
      if (!raw || Object.keys(raw).length === 0) {
        listRoot.innerHTML =
          '<p class="empty-state">Import the Club Central roster first to see who needs onboarding help. ' +
          '<a href="#syncData">Go to Sync Data</a>.</p>';
        return;
      }

      const data = anonymize ? anonymizeClubCentralScrape(raw) : raw;
      const buckets = collectNeedingOnboarding(data);

      if (buckets.length === 0) {
        listRoot.innerHTML =
          '<p class="empty-state">🎉 Every paid-up member is already enrolled in Pathways — nothing to do here.</p>';
        return;
      }

      const total = buckets.reduce((n, b) => n + b.members.length, 0);
      const summary =
        `<p class="help-text">${total} paid member${total === 1 ? "" : "s"} not yet enrolled in Pathways, ` +
        `across ${buckets.length} club${buckets.length === 1 ? "" : "s"}.</p>`;
      listRoot.innerHTML = summary + buckets.map(renderBucket).join("");
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") render();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await render();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
