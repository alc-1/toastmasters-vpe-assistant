// src/entrypoints/app/views/dashboard.ts
//
// The Home dashboard — the merged app's default route (entrypoints/app/router.ts
// resolves an empty/unknown hash here) and its hub: a "Club Data Status" hero
// banner tracking the four setup steps (its badge + CTA adapt to how far the
// user has got — see renderBanner()), and a two-column grid of feature tiles
// (Club Progress, the standalone Excel Exporter, a placeholder Approval
// Helper, and Save/Restore backup).
//
// Privacy Mode and the active-profile chip live in the shared header now
// (shared/app-shell.ts, wired by entrypoints/app/main.ts) — not on this view.
//
// Standalone, not a wizard step: entrypoints/app/main.ts renders this route
// with showStepper:false (header only, no horizontal stepper) and no step
// footer. Same ViewModule lifecycle every other view follows — see
// shared/view.ts and syncData.ts's mount() for the disposed-guard rationale.

import {
  areFeaturesUnlocked,
  computeStepperInfo,
  evaluateSetupPipeline,
  isSetupStepComplete,
  SETUP_STEPS,
  type SetupBannerState,
} from "../../../shared/stepper-info";
import { downloadBackup, parseBackup, restoreBackup } from "../../../shared/backup";
import { confirmModal } from "../../../shared/modal";
import { escapeHtml } from "../../../shared/dom-utils";
import type { AppShellPage, StepperInfo } from "../../../shared/app-shell";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <div id="dashboardBannerRoot"></div>

  <div class="dashboard-features" id="dashboardFeaturesRoot"></div>
`;

// Copy + CTA per banner state. The state machine that picks the state (and
// resolves the resume step) lives in shared/stepper-info.ts's
// evaluateSetupPipeline() — pure and unit-tested, and deliberately blind to
// Privacy Mode. `dot` is the .dashboard-status__dot modifier (amber for the
// first three, green for ready); `label` is static except reviewNeeded, whose
// "(N items)" count is appended in renderBanner(). CTA target: reviewNeeded →
// #members; ready → #syncData ("Refresh Data"); otherwise the furthest step
// the user has actually reached.
const BANNER_COPY: Record<SetupBannerState, { dot: string; label: string; cta: string }> = {
  required: { dot: "is-progress", label: "Setup Required", cta: "Start Setup →" },
  progress: { dot: "is-progress", label: "Setup In Progress", cta: "Continue Setup →" },
  reviewNeeded: { dot: "is-warning", label: "Review Needed", cta: "Review Unmatched →" },
  ready: { dot: "is-ready", label: "Club Data Ready", cta: "Refresh Data" },
};

type TileAccent = "indigo" | "emerald" | "amber" | "slate";

// Full class names spelled out as literals (not built by interpolation) so
// Tailwind's content scanner keeps the matching `.dashboard-tile__icon--*`
// rules in styles.css's @layer components instead of tree-shaking them.
const ACCENT_ICON_CLASS: Record<TileAccent, string> = {
  indigo: "dashboard-tile__icon--indigo",
  emerald: "dashboard-tile__icon--emerald",
  amber: "dashboard-tile__icon--amber",
  slate: "dashboard-tile__icon--slate",
};

// One distinct glyph per tile — inline stroke="currentColor" SVGs (same
// approach as shared/dom-utils.ts's icons, kept local since they're only
// used here). The wrapping .dashboard-tile__icon is aria-hidden, so these
// carry no title of their own.
function tileIcon(paths: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const ICON_PROGRESS = tileIcon('<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>');
const ICON_SPREADSHEET = tileIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>');
const ICON_APPROVAL = tileIcon('<path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="M9 2h6v4H9z"/><path d="M9 14l2 2 4-4"/>');
const ICON_BACKUP = tileIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h7"/>');

interface FeatureCard {
  title: string;
  description: string;
  accent: TileAccent;
  iconHtml: string;
  /** The single-CTA label. Omitted for the `backup` tile (two buttons). */
  ctaLabel?: string;
  href?: string;
  badgeNew?: boolean;
  /** Rendered but inert with a "Requires imported data" badge. */
  locked?: boolean;
  /** Rendered but inert with a "Coming soon" note (Approval Helper). */
  comingSoon?: boolean;
  /** The Save/Restore tile: two buttons + a status line instead of one CTA. */
  backup?: boolean;
}

type RestoreStatus = { kind: "ok" | "error"; text: string } | null;

export const dashboardView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // See syncData.ts's mount() for the full writeup: an async render()
    // resuming after the view was navigated away from must not write into
    // the #viewRoot node a different view now owns.
    let disposed = false;
    // Tears down a still-open restore confirm modal if the user navigates
    // away mid-decision.
    const restoreAbort = new AbortController();

    const bannerRoot = root.querySelector("#dashboardBannerRoot")!;
    const featuresRoot = root.querySelector("#dashboardFeaturesRoot")!;

    // Persisted across render() calls so a "Restored" / error message
    // survives the storage.onChanged-triggered re-render that a successful
    // restore itself causes.
    let restoreStatus: RestoreStatus = null;

    // One hidden file input, reused for every "Load File" click.
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    root.appendChild(fileInput);
    fileInput.addEventListener("change", onBackupFileChosen);

    function renderBanner(info: StepperInfo) {
      // A step's box is checked using the same rule the wizard stepper uses —
      // `done` but not still `locked` (never visited by this profile). So a
      // step whose requirement is already satisfied but which the user hasn't
      // reached yet (e.g. Club Review when every club auto-matched) stays
      // unchecked, exactly as the stepper shows it.
      const stepComplete = (key: AppShellPage): boolean => isSetupStepComplete(info[key]);

      // Every derived pipeline value comes from one pure, unit-tested place
      // that is deliberately blind to Privacy Mode — toggling the name mask
      // must never move the banner state, the tracker, or the CTA.
      const {
        bannerState: state,
        completedSteps: completed,
        totalSteps: total,
        pendingReviewCount: pendingCount,
        resumeStep,
      } = evaluateSetupPipeline(info);

      const { dot: dotClass, cta } = BANNER_COPY[state];
      const statusLabel =
        state === "reviewNeeded"
          ? `Review Needed (${pendingCount} item${pendingCount === 1 ? "" : "s"})`
          : BANNER_COPY[state].label;

      // "Continue Setup" resumes at `resumeStep` — the furthest step this
      // profile has actually opened, resolved by evaluateSetupPipeline(). The
      // Home screen never skips the user past a step they haven't seen;
      // entering a new step for the first time only happens from inside the
      // wizard via the step footer's "Continue to X" button. Once setup is
      // complete, "Refresh Data" jumps straight to Sync Data instead — the
      // only step a returning user wants when re-pulling club progress.
      // reviewNeeded links straight to Member Review — the merged app's route
      // for step 4 (there is no "?step=" param scheme; it's hash routing) —
      // which mounts on its "To do" filter by default (see
      // entrypoints/app/views/members.ts's activeFilter), i.e. exactly the
      // unresolved list.
      const ctaHref =
        state === "ready" ? "#syncData" : state === "reviewNeeded" ? "#members" : `#${resumeStep}`;

      // syncData.info is already "Updated 3 days ago" (shared/stepper-info.ts's
      // formatOldestSync/formatRelativeTime) — reuse it rather than recomputing.
      const syncInfo = info.syncData?.info;
      const timestampHtml =
        info.syncData?.done && syncInfo && syncInfo.startsWith("Updated ")
          ? `<span class="dashboard-status__timestamp">Last updated ${escapeHtml(syncInfo.slice("Updated ".length))}</span>`
          : "";

      const wideSteps = SETUP_STEPS.map((step, i) => {
        const meta = info[step.key];
        const done = stepComplete(step.key);
        // Member Review shows an amber "still N to review" marker + "(N)"
        // suffix instead of a checkmark while items remain — mirrors the
        // wizard stepper's own warning state (shared/app-shell.ts's
        // circleGlyph), and the count is what the CTA's "To do" list shows.
        const warn = !done && !!meta?.warning && !meta.locked && (meta.warningCount ?? 0) > 0;
        // The step the CTA links to — the furthest one reached. Highlighted
        // navy (filled marker + bold navy label) so the banner reads as one
        // "you are here → <CTA>" unit; the amber warning styling takes over
        // when both would apply to the same step.
        const isResumeTarget = state !== "ready" && step.key === resumeStep;
        const current = isResumeTarget && !warn;

        const marker = done ? "&#10003;" : warn ? "!" : String(i + 1);
        const nameSuffix = warn ? ` (${meta?.warningCount ?? 0})` : "";
        const stepClass = `dashboard-tracker__step${done ? " is-done" : ""}${warn ? " is-warning" : ""}${current ? " is-current" : ""}`;
        return `<li class="${stepClass}"${isResumeTarget ? ' aria-current="step"' : ""}>
              <span class="dashboard-tracker__marker" aria-hidden="true">${marker}</span>
              <span class="dashboard-tracker__name">${escapeHtml(step.label)}${escapeHtml(nameSuffix)}</span>
            </li>`;
      }).join('<span class="dashboard-tracker__connector" aria-hidden="true"></span>');

      const narrowText =
        state === "reviewNeeded"
          ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} still to review`
          : completed === total
            ? "All 4 setup steps complete"
            : `Step ${completed + 1} of ${total}`;

      bannerRoot.innerHTML = `
        <div class="dashboard-status">
          <div class="dashboard-status__main">
            <div class="dashboard-status__headline">
              <span class="dashboard-status__dot ${dotClass}" aria-hidden="true"></span>
              <span class="dashboard-status__label">${statusLabel}</span>
              ${timestampHtml}
            </div>
            <ol class="dashboard-tracker dashboard-tracker--wide">${wideSteps}</ol>
            <p class="dashboard-tracker dashboard-tracker--narrow">${narrowText}</p>
          </div>
          <a href="${ctaHref}" class="btn btn-primary dashboard-status__cta">${escapeHtml(cta)}</a>
        </div>
      `;
    }

    function renderFeatures(featuresUnlocked: boolean) {
      const cards: FeatureCard[] = [
        {
          title: "Club Progress Report",
          description: "See who is ready to level up and review discrepancies between systems.",
          accent: "indigo",
          iconHtml: ICON_PROGRESS,
          ctaLabel: "Open Report →",
          href: "#report",
          locked: !featuresUnlocked,
        },
        {
          title: "Download Excel Spreadsheet",
          description: "Export member progress and path history to an Excel workbook.",
          accent: "emerald",
          iconHtml: ICON_SPREADSHEET,
          ctaLabel: "Create Spreadsheet →",
          href: "#exporter",
          locked: !featuresUnlocked,
        },
        {
          title: "Pathways Approval Helper",
          description: "Check live Basecamp completion details for a member before approving.",
          accent: "amber",
          iconHtml: ICON_APPROVAL,
          badgeNew: true,
          ctaLabel: "Select Member →",
          comingSoon: true,
        },
        {
          title: "Save or Restore Club Settings",
          description: "Save a backup file of your member links or restore a saved file.",
          accent: "slate",
          iconHtml: ICON_BACKUP,
          backup: true,
        },
      ];

      featuresRoot.innerHTML = cards.map(renderFeatureCard).join("");

      const saveBtn = featuresRoot.querySelector("#dashboardSaveBackupBtn");
      const loadBtn = featuresRoot.querySelector("#dashboardLoadBackupBtn");
      if (saveBtn) saveBtn.addEventListener("click", onSaveBackup);
      if (loadBtn) loadBtn.addEventListener("click", () => fileInput.click());
    }

    function renderFeatureCard(card: FeatureCard): string {
      const badge = card.badgeNew ? '<span class="badge badge-info dashboard-tile__badge">NEW</span>' : "";
      const inert = card.comingSoon || card.locked;
      // A single-CTA active card becomes one big click target: the article is
      // position:relative and its CTA link stretches over it via ::after
      // (the "stretched link" pattern). The link stays a real
      // <a href="#route">, so hashchange routing is unchanged — no JS added.
      const interactive = !inert && !card.backup;

      let footer: string;
      if (card.backup) {
        const statusClass = restoreStatus?.kind === "error" ? " is-error" : "";
        footer = `
          <div class="dashboard-tile__actions">
            <button type="button" class="btn btn-secondary" id="dashboardSaveBackupBtn" title="Downloads a .json file">Save File</button>
            <button type="button" class="btn btn-secondary" id="dashboardLoadBackupBtn" title="Choose a .json backup file">Load File</button>
          </div>
          <p class="help-text dashboard-tile__status${statusClass}" aria-live="polite">${restoreStatus ? escapeHtml(restoreStatus.text) : ""}</p>
        `;
      } else if (inert) {
        const cta = `<span class="btn btn-primary dashboard-tile__cta" aria-disabled="true">${escapeHtml(card.ctaLabel ?? "")}</span>`;
        const trailing = card.comingSoon
          ? '<span class="dashboard-tile__soon">Coming soon</span>'
          : '<span class="badge badge-muted dashboard-tile__lock">&#128274; Requires imported data</span>';
        footer = `${cta}${trailing}`;
      } else {
        footer = `<a href="${card.href}" class="btn btn-primary dashboard-tile__cta">${escapeHtml(card.ctaLabel ?? "")}</a>`;
      }

      const articleClass = `dashboard-tile${inert ? " is-locked" : ""}${interactive ? " dashboard-tile--link" : ""}`;
      return `
        <article class="${articleClass}">
          <div class="dashboard-tile__head">
            <span class="dashboard-tile__icon ${ACCENT_ICON_CLASS[card.accent]}" aria-hidden="true">${card.iconHtml}</span>
            <h2 class="dashboard-tile__title">${escapeHtml(card.title)}</h2>
            ${badge}
          </div>
          <p class="dashboard-tile__desc">${escapeHtml(card.description)}</p>
          <div class="dashboard-tile__footer">${footer}</div>
        </article>
      `;
    }

    async function onSaveBackup() {
      restoreStatus = null;
      try {
        await downloadBackup();
        if (disposed) return;
        restoreStatus = { kind: "ok", text: "Backup file saved." };
      } catch (err) {
        restoreStatus = { kind: "error", text: `Could not save backup: ${err instanceof Error ? err.message : String(err)}` };
      }
      await render();
    }

    async function onBackupFileChosen() {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // allow re-picking the same file later
      if (!file) return;

      restoreStatus = null;
      let backup;
      try {
        backup = parseBackup(await file.text());
      } catch (err) {
        restoreStatus = { kind: "error", text: err instanceof Error ? err.message : String(err) };
        await render();
        return;
      }
      if (disposed) return;

      const confirmed = await confirmModal({
        title: "Replace all current data?",
        body: "Loading this backup file will overwrite your current profiles, imported data, matches, and settings. This can't be undone.",
        confirmLabel: "Load Backup",
        cancelLabel: "Cancel",
        danger: true,
        signal: restoreAbort.signal,
      });
      if (!confirmed || disposed) return;

      try {
        await restoreBackup(backup);
        if (disposed) return;
        restoreStatus = { kind: "ok", text: "Backup restored." };
      } catch (err) {
        restoreStatus = { kind: "error", text: `Restore failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      await render();
    }

    async function render() {
      const info = await computeStepperInfo();
      if (disposed) return;
      renderBanner(info);
      renderFeatures(areFeaturesUnlocked(info));
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") render();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await render();

    return () => {
      disposed = true;
      restoreAbort.abort();
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
