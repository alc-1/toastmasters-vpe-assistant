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
  type SetupPipelineState,
} from "../../../shared/stepper-info";
import { downloadBackup, parseBackup, restoreBackup } from "../../../shared/backup";
import { confirmModal } from "../../../shared/modal";
import { escapeHtml } from "../../../shared/dom-utils";
import { formatProfileLabel, getActiveProfile } from "../../../shared/settings-store";
import { loadResolutionData } from "../../../shared/resolution-store";
import { local } from "../../../shared/storage";
import { buildReport, computeMatchSummary, countBasecampMembers, countEasySpeakMembers } from "../../../shared/sync/delta";
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
  /** Rendered but inert with a "Requires imported data" badge + a disabled
   *  preview of the CTA (so the card still says what unlocking it gives). */
  locked?: boolean;
  /** Rendered but inert with just a "Coming soon" badge — no CTA at all
   *  (Approval Helper). */
  comingSoon?: boolean;
  /** The Save/Restore tile: two buttons + a status line instead of one CTA. */
  backup?: boolean;
}

type RestoreStatus = { kind: "ok" | "error"; text: string } | null;

// Per-step figures shown inside the "Setup Complete" accordion's expanded
// panel (see renderSetupCompletePanel). Only computed — and the accordion
// only rendered — once setup is complete (bannerState === "ready"), so both
// data sources are guaranteed present by the time this runs.
interface SetupDetails {
  profileLabel: string;
  basecampMembers: number;
  easyspeakMembers: number;
  clubCount: number;
  matchedMembers: number;
  toReview: number;
  /** Locale date+time of the oldest of the two source syncs. */
  syncAbsolute: string;
  /** "4 minutes ago" — reused from syncData.info's "Updated …" phrasing. */
  syncRelative: string | null;
}

async function computeSetupDetails(info: StepperInfo): Promise<SetupDetails | null> {
  const cached = await local.get([
    "basecampData",
    "basecampScrapedAt",
    "basecampCompletedPaths",
    "easyspeakData",
    "easyspeakScrapedAt",
  ]);
  const { basecampData, easyspeakData } = cached;
  if (!basecampData || !easyspeakData) return null;

  const [profile, resolution] = await Promise.all([getActiveProfile(), loadResolutionData()]);
  const report = buildReport(basecampData, easyspeakData, {}, resolution, cached.basecampCompletedPaths ?? {});
  const { matched } = computeMatchSummary(report);

  const stamps = [cached.basecampScrapedAt, cached.easyspeakScrapedAt].filter(
    (t): t is number => typeof t === "number"
  );
  const oldest = stamps.length ? Math.min(...stamps) : undefined;

  const syncInfo = info.syncData?.info;
  const syncRelative = syncInfo?.startsWith("Updated ") ? syncInfo.slice("Updated ".length) : null;

  return {
    profileLabel: formatProfileLabel(profile),
    basecampMembers: countBasecampMembers(basecampData),
    easyspeakMembers: countEasySpeakMembers(easyspeakData),
    clubCount: report.clubPairs.length,
    matchedMembers: matched,
    toReview: info.members?.warningCount ?? 0,
    syncAbsolute: oldest ? new Date(oldest).toLocaleString() : "just now",
    syncRelative,
  };
}

function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

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

    // Whether the "Setup Complete" accordion is expanded. Held here (not in
    // storage) so it survives the storage.onChanged-triggered re-renders that
    // are frequent on this view, while still defaulting back to collapsed
    // whenever the view is re-mounted. bannerRoot is a stable node reused
    // across every renderBanner() call, so this delegated listener is bound
    // once and the freshly-rendered markup just reads `setupDetailsOpen` for
    // its initial state.
    let setupDetailsOpen = false;
    function onBannerClick(e: Event) {
      const toggle = (e.target as HTMLElement).closest<HTMLElement>("#setupDetailsToggle");
      if (!toggle) return;
      setupDetailsOpen = !setupDetailsOpen;
      bannerRoot.querySelector(".setup-complete")?.classList.toggle("is-open", setupDetailsOpen);
      toggle.setAttribute("aria-expanded", String(setupDetailsOpen));
    }
    bannerRoot.addEventListener("click", onBannerClick);

    // Whole-card navigation: a click anywhere on a `.dashboard-tile--link`
    // tile follows its CTA link. Delegated and bound once here — featuresRoot
    // is a stable node reused across every renderFeatures() re-render, so
    // binding inside renderFeatures() would stack duplicate listeners. Clicks
    // that land on a genuine interactive element (the CTA anchor itself, or a
    // future button) fall through to that element's own handling.
    function onFeatureCardClick(e: Event) {
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, label")) return;
      const tile = target.closest(".dashboard-tile--link");
      const href = tile?.querySelector(".dashboard-tile__cta")?.getAttribute("href");
      if (href?.startsWith("#")) location.hash = href.slice(1);
    }
    featuresRoot.addEventListener("click", onFeatureCardClick);

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

    function renderBanner(info: StepperInfo, details: SetupDetails | null) {
      const pipeline = evaluateSetupPipeline(info);

      // Once all four steps are done the guiding progress banner is replaced
      // by the collapsible "Setup Complete" panel — a calm one-line
      // confirmation that expands to a per-step recap. The in-progress banner
      // below still handles every earlier state unchanged.
      if (pipeline.bannerState === "ready" && details) {
        renderSetupCompletePanel(pipeline, details);
        return;
      }

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
      } = pipeline;

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

      // The status headline + timestamp are grouped with the CTA on the right
      // (data status and the action that changes it read as one unit); the
      // step tracker on the left is a read-only progress indicator, captioned
      // and styled distinctly from the interactive wizard stepper.
      bannerRoot.innerHTML = `
        <div class="dashboard-status">
          <div class="dashboard-status__progress">
            <p class="dashboard-status__caption">Setup progress</p>
            <ol class="dashboard-tracker dashboard-tracker--wide">${wideSteps}</ol>
            <p class="dashboard-tracker dashboard-tracker--narrow">${narrowText}</p>
          </div>
          <div class="dashboard-status__action">
            <span class="dashboard-status__headline">
              <span class="dashboard-status__dot ${dotClass}" aria-hidden="true"></span>
              <span class="dashboard-status__label">${statusLabel}</span>
            </span>
            ${timestampHtml}
            <a href="${ctaHref}" class="btn btn-primary dashboard-status__cta">${escapeHtml(cta)}</a>
          </div>
        </div>
      `;
    }

    function renderSetupCompletePanel(pipeline: SetupPipelineState, d: SetupDetails) {
      const syncLine = d.syncRelative
        ? `${escapeHtml(d.syncAbsolute)} (${escapeHtml(d.syncRelative)})`
        : escapeHtml(d.syncAbsolute);

      // Setup can be "complete" (the user hit "Complete Setup") while
      // Member Review still has unresolved matches. When it does, Step 4 —
      // and the panel's own header — swap the green check for the same amber
      // "!" marker + "(N)" suffix the in-progress tracker above uses for its
      // Member Review step (see renderBanner's wideSteps).
      const needsReview = d.toReview > 0;
      const reviewLabel = `${countLabel(d.toReview, "member")} still to review`;

      // name / detail (may hold trusted markup) / where the step's secondary
      // button goes / that button's label / whether it renders as a warning.
      // Friendly, non-technical wording.
      const steps: { name: string; detail: string; href: string; action: string; warn?: boolean }[] = [
        {
          name: "Setup",
          detail: `Selected: <strong>${escapeHtml(d.profileLabel)}</strong>`,
          href: "#setup",
          action: "Change Profile",
        },
        {
          name: "Sync Data",
          detail:
            `EasySpeak: ${escapeHtml(countLabel(d.easyspeakMembers, "member"))} &nbsp;|&nbsp; ` +
            `Basecamp: ${escapeHtml(countLabel(d.basecampMembers, "member"))}` +
            `<span class="setup-steps__meta">Last sync: ${syncLine}</span>`,
          href: "#syncData",
          action: "Refresh Data",
        },
        {
          name: "Club Review",
          detail: `${escapeHtml(countLabel(d.clubCount, "club"))} connected across both platforms`,
          href: "#clubReview",
          action: "Check Clubs",
        },
        {
          name: "Member Review",
          detail: needsReview
            ? `${escapeHtml(countLabel(d.matchedMembers, "member"))} matched &middot; ${escapeHtml(reviewLabel)}`
            : `${escapeHtml(countLabel(d.matchedMembers, "member"))} matched across both platforms`,
          href: "#members",
          action: "Audit Member List",
          warn: needsReview,
        },
      ];

      const rows = steps
        .map((s, i) => {
          const marker = s.warn ? "!" : "&#10003;";
          const nameSuffix = s.warn ? ` (${d.toReview})` : "";
          return `
            <li class="setup-steps__row${s.warn ? " is-warning" : ""}">
              <span class="setup-steps__marker" aria-hidden="true">${marker}</span>
              <div class="setup-steps__text">
                <p class="setup-steps__name">${escapeHtml(`Step ${i + 1} — ${s.name}${nameSuffix}`)}</p>
                <p class="setup-steps__detail">${s.detail}</p>
              </div>
              <a href="${s.href}" class="btn btn-secondary btn-sm setup-steps__action">${escapeHtml(s.action)}</a>
            </li>`;
        })
        .join("");

      const headMarker = needsReview ? "!" : "&#10003;";
      const subLine = needsReview
        ? escapeHtml(reviewLabel)
        : d.syncRelative
          ? `Last sync: ${escapeHtml(d.syncRelative)}`
          : `Last sync: ${escapeHtml(d.syncAbsolute)}`;

      bannerRoot.innerHTML = `
        <div class="setup-complete${setupDetailsOpen ? " is-open" : ""}${needsReview ? " has-review" : ""}">
          <div class="setup-complete__bar">
            <span class="setup-complete__check" aria-hidden="true">${headMarker}</span>
            <div class="setup-complete__headline">
              <p class="setup-complete__title">Setup Complete (${pipeline.completedSteps}/${pipeline.totalSteps} Steps)</p>
              <p class="setup-complete__sub">${subLine}</p>
            </div>
            <div class="setup-complete__actions">
              <button type="button" id="setupDetailsToggle" class="btn btn-secondary btn-sm setup-complete__toggle"
                      aria-expanded="${setupDetailsOpen}" aria-controls="setupDetailsPanel">
                View Setup Details <span class="setup-complete__chevron" aria-hidden="true">&#9662;</span>
              </button>
              <a href="#syncData" class="btn btn-primary btn-sm setup-complete__refresh">Refresh Data</a>
            </div>
          </div>
          <div class="setup-complete__details" id="setupDetailsPanel" role="region" aria-label="Setup details">
            <div class="setup-complete__details-inner">
              <ol class="setup-steps">${rows}</ol>
            </div>
          </div>
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
      const inert = card.comingSoon || card.locked;
      // A single-CTA active card becomes one big click target (see
      // onFeatureCardClick() in mount()): the whole `.dashboard-tile--link`
      // article follows its CTA link on click. The CTA stays a real
      // <a href="#route"> so keyboard activation and hashchange routing are
      // unchanged.
      const interactive = !inert && !card.backup;

      let footer: string;
      if (card.backup) {
        // Save/Load are utility actions — bordered secondary buttons, clearly
        // subordinate to the primary CTAs on the other cards.
        const statusClass = restoreStatus?.kind === "error" ? " is-error" : "";
        footer = `
          <div class="dashboard-tile__actions">
            <button type="button" class="btn btn-secondary" id="dashboardSaveBackupBtn" title="Downloads a .json file">Save File</button>
            <button type="button" class="btn btn-secondary" id="dashboardLoadBackupBtn" title="Choose a .json backup file">Load File</button>
          </div>
          <p class="help-text dashboard-tile__status${statusClass}" aria-live="polite">${restoreStatus ? escapeHtml(restoreStatus.text) : ""}</p>
        `;
      } else if (card.comingSoon) {
        // No disabled button — just a single status tag (design feedback).
        footer = '<span class="badge badge-soft dashboard-tile__soon">Coming soon</span>';
      } else if (card.locked) {
        footer = `
          <span class="btn btn-primary dashboard-tile__cta" aria-disabled="true">${escapeHtml(card.ctaLabel ?? "")}</span>
          <span class="badge badge-soft dashboard-tile__lock">&#128274; Requires imported data</span>
        `;
      } else {
        footer = `<a href="${card.href}" class="btn btn-primary dashboard-tile__cta">${escapeHtml(card.ctaLabel ?? "")}</a>`;
      }

      const articleClass = `dashboard-tile${inert ? " is-locked" : ""}${interactive ? " dashboard-tile--link" : ""}`;
      return `
        <article class="${articleClass}">
          <div class="dashboard-tile__head">
            <span class="dashboard-tile__icon ${ACCENT_ICON_CLASS[card.accent]}" aria-hidden="true">${card.iconHtml}</span>
            <h2 class="dashboard-tile__title">${escapeHtml(card.title)}</h2>
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
      // Only the "Setup Complete" panel needs the per-step figures, so skip
      // the extra buildReport() pass in every earlier state.
      const details =
        evaluateSetupPipeline(info).bannerState === "ready" ? await computeSetupDetails(info) : null;
      if (disposed) return;
      renderBanner(info, details);
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
      featuresRoot.removeEventListener("click", onFeatureCardClick);
      bannerRoot.removeEventListener("click", onBannerClick);
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
