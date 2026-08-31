// src/entrypoints/app/views/onboarding.ts
//
// Pathways Onboarding Helper — lists Club Central roster members who still
// need Pathways enrollment, split by payment status so a VPE can plan
// outreach:
//   • "ready"   — paid up, not yet enrolled: reach out and help them start.
//   • "pending" — not paid, not yet enrolled: chase the renewal first.
// Sourced entirely from the Club Central roster (shared/types.ts's
// ClubCentralScrape) — it never touches basecampData/easyspeakData or
// buildReport().
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

type OnboardingStatus = "ready" | "pending";
type OnboardingFilter = "all" | OnboardingStatus;

interface OnboardingMember extends ClubCentralMemberRow {
  status: OnboardingStatus;
}

interface ClubBucket {
  clubName: string;
  members: OnboardingMember[];
}

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">Pathways Onboarding Helper</h1>
    <p class="page-intro__desc">
      Members who need Pathways enrollment — filter by payment status to plan upcoming onboarding.
    </p>
  </div>
  <p id="onboardingAnonymizeNotice" class="help-text" aria-live="polite"></p>
  <div id="onboardingFilters" class="toolbar"></div>
  <div id="onboardingRoot"></div>
`;

const FILTERS: { key: OnboardingFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready to Onboard" },
  { key: "pending", label: "Pending Payment" },
];

const DEFAULT_FILTER: OnboardingFilter = "ready";

// A roster member needs onboarding only when they haven't enrolled in a path
// yet. "Paid" → ready to start now; "Membership Pending" → their membership
// isn't finalised, so hold off until it is. "Unpaid"/"Unknown" aren't
// actionable onboarding targets, so they're left out entirely.
function statusFor(m: ClubCentralMemberRow): OnboardingStatus | null {
  if (m.pathwaysEnrolled) return null;
  if (m.paymentStatus === "Paid") return "ready";
  if (m.paymentStatus === "Membership Pending") return "pending";
  return null;
}

// Ready members sort ahead of pending ones (they're the actionable group),
// then alphabetically by name within each status.
const STATUS_RANK: Record<OnboardingStatus, number> = { ready: 0, pending: 1 };

function collectBuckets(data: ClubCentralScrape): ClubBucket[] {
  return Object.values(data)
    .map((club) => ({
      clubName: club.name,
      members: club.members
        .flatMap<OnboardingMember>((m) => {
          const status = statusFor(m);
          return status ? [{ ...m, status }] : [];
        })
        .sort(
          (a, b) =>
            STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
    }))
    .filter((bucket) => bucket.members.length > 0)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, undefined, { sensitivity: "base" }));
}

const STATUS_BADGE: Record<OnboardingStatus, string> = {
  ready: '<span class="badge badge-soft badge-warning">Ready to Onboard</span>',
  pending: '<span class="badge badge-soft badge-neutral">Pending Payment</span>',
};

function paidThroughCell(m: OnboardingMember): string {
  if (m.status === "pending") return '<span class="muted-text">Membership pending</span>';
  return m.paidUntil ? escapeHtml(m.paidUntil) : '<span class="muted-text">—</span>';
}

function renderRow(m: OnboardingMember): string {
  // Pending-payment rows are muted so the eye lands on the actionable
  // "ready" members first (see spec point 4).
  const rowClass = m.status === "pending" ? ' class="opacity-70"' : "";
  return `
    <tr${rowClass} data-status="${m.status}">
      <td>${escapeHtml(m.name)}</td>
      <td>${m.position ? escapeHtml(m.position) : '<span class="muted-text">—</span>'}</td>
      <td>${STATUS_BADGE[m.status]}</td>
      <td>${paidThroughCell(m)}</td>
    </tr>`;
}

function renderBucket(bucket: ClubBucket, filter: OnboardingFilter): string {
  const visible =
    filter === "all" ? bucket.members : bucket.members.filter((m) => m.status === filter);
  if (visible.length === 0) return "";

  const count = visible.length;
  return `
    <div class="card">
      <div class="card-header">
        <span class="card-header__title">${escapeHtml(bucket.clubName)}</span>
        <span class="badge badge-soft badge-neutral">${count} member${count === 1 ? "" : "s"}</span>
      </div>
      <div class="card-body">
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Position</th><th>Status</th><th>Paid through</th></tr></thead>
            <tbody>${visible.map(renderRow).join("")}</tbody>
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
    let buckets: ClubBucket[] = [];
    let hasData = false;
    let activeFilter: OnboardingFilter = DEFAULT_FILTER;

    const notice = root.querySelector("#onboardingAnonymizeNotice")!;
    const filterRoot = root.querySelector<HTMLElement>("#onboardingFilters")!;
    const listRoot = root.querySelector("#onboardingRoot")!;

    function counts(): Record<OnboardingFilter, number> {
      const all = buckets.flatMap((b) => b.members);
      return {
        all: all.length,
        ready: all.filter((m) => m.status === "ready").length,
        pending: all.filter((m) => m.status === "pending").length,
      };
    }

    function renderFilters() {
      if (!hasData || buckets.length === 0) {
        filterRoot.innerHTML = "";
        return;
      }
      const c = counts();
      filterRoot.innerHTML = FILTERS.map(
        (f) =>
          `<button class="chip${f.key === activeFilter ? " active" : ""}" data-filter="${f.key}">` +
          `${escapeHtml(f.label)} <span class="chip-count">${c[f.key]}</span></button>`,
      ).join("");
    }

    function renderList() {
      if (!hasData) {
        listRoot.innerHTML =
          '<p class="empty-state">Import the Club Central roster first to see who needs onboarding help. ' +
          '<a href="#syncData">Go to Sync Data</a>.</p>';
        return;
      }
      if (buckets.length === 0) {
        listRoot.innerHTML =
          '<p class="empty-state">🎉 No members are waiting for Pathways enrollment right now.</p>';
        return;
      }
      const cards = buckets.map((b) => renderBucket(b, activeFilter)).join("");
      listRoot.innerHTML =
        cards || '<p class="empty-state">No members match this filter.</p>';
    }

    async function load() {
      const [cached, anonymize] = await Promise.all([
        local.get(["clubCentralData"]),
        getAnonymizeMode(),
      ]);
      if (disposed) return;

      notice.textContent = anonymize ? "Privacy Mode is on — member names are anonymized." : "";

      const raw = cached.clubCentralData ?? null;
      hasData = !!raw && Object.keys(raw).length > 0;
      buckets = hasData
        ? collectBuckets(anonymize ? anonymizeClubCentralScrape(raw!) : raw!)
        : [];

      renderFilters();
      renderList();
    }

    // Delegated: the container node itself is never replaced, only its
    // innerHTML, so this one listener covers every re-render.
    filterRoot.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
      const next = btn?.dataset.filter as OnboardingFilter | undefined;
      if (!next || next === activeFilter) return;
      activeFilter = next;
      renderFilters();
      renderList();
    });

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
