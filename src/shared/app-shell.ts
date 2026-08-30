// src/shared/app-shell.ts
//
// Single source of truth for the branded header + stepper nav shared by the
// four wizard steps (Setup, Sync Data, Club Review, Member Review). Rendered
// via innerHTML into a `<div id="appShell">` placeholder, matching this
// codebase's existing plain-template style — no framework, no partial-file
// includes (HTML has none), so a shared TS function is what stands in for a
// "layout component" here. Club Progress (#report) used to be a fifth step
// but is now a hub feature reached from the Home dashboard, so it's no longer
// in NAV_ITEMS / the stepper.
//
// The stepper is a sibling of the header, not nested inside it (see
// shared/styles.css's ".app-stepper" block) — steps are plain direct-
// navigation links, not a gated wizard; only the current page's step is
// highlighted.
//
// Each page calls renderAppShell() once on init — the header itself never
// changes after that (no per-page subtitle beyond the fixed mission
// statement below: Club Progress/Member Review already show the active
// club as a tab immediately below, so repeating its name here would just be
// redundant).
//
// renderVerticalStepper() (bottom of this file) is the popup's version of
// the same idea, rotated 90 degrees to fit the popup's narrow width. It
// shares NAV_ITEMS (order + labels) but not renderAppShell()'s header/markup,
// since the popup already has its own hand-written header (see
// popup/index.html) — and, since shared/stepper-info.ts's computeStepperInfo(),
// the same per-step info line (e.g. "12 clubs followed") shown under each
// step's label, so both steppers surface identical information.

import { chevronIconHtml, escapeHtml, settingsIconHtml, sparkleIconHtml, warningIconHtml } from "./dom-utils";
import { changelogHighlights, formatChangelogDate, type VersionBadgeState } from "./whats-new-format";

// "report" (Club Progress) is still a valid AppRoute (shared/pages.ts) and a
// StepperInfo slot, but it's no longer one of the wizard steps in NAV_ITEMS
// — it's reached from the Home dashboard's feature grid, like #exporter.
export type AppShellPage = "report" | "members" | "setup" | "syncData" | "clubReview";

// The four wizard steps, in display order: Setup, Sync Data, Club Review,
// Member Review. Exported so the popup's vertical stepper
// (renderVerticalStepper below) shares the exact same label/order as this
// horizontal one instead of maintaining its own copy — href values are hash
// fragments (e.g. "#setup") resolved by entrypoints/app/router.ts within
// the single merged app.html, which is meaningless from the popup; the
// popup instead opens each step in a new tab directly via
// browser.tabs.create()/shared/pages.ts's appRouteUrl(), ignoring these
// hrefs entirely.
export const NAV_ITEMS: { key: AppShellPage; label: string; href: string }[] = [
  { key: "setup", label: "Setup", href: "#setup" },
  { key: "syncData", label: "Sync Data", href: "#syncData" },
  { key: "clubReview", label: "Club Review", href: "#clubReview" },
  { key: "members", label: "Member Review", href: "#members" },
];

const GOAL_SUBTITLE = "Bring EasySpeak and Basecamp data together in one place.";

/** Per-step metadata computed by shared/stepper-info.ts's computeStepperInfo()
 *  and shared verbatim by both renderAppShell() and renderVerticalStepper()
 *  below. `info` is the contextual line shown under a step's label (e.g. "12
 *  clubs followed" under Club Review) — plain text, escaped by each renderer,
 *  omitted whenever the step's prerequisites aren't met. `disabled` marks a
 *  step whose prerequisite isn't met yet (e.g. no data source chosen, or an
 *  earlier step still has unresolved reviews) — rendered as an inert,
 *  non-navigable step rather than a link. `done` marks a step whose own
 *  requirement is fully satisfied (e.g. a profile is selected, or a review
 *  queue is empty) — its circle shows a checkmark instead of the step number.
 *  `warning` marks a step with something needing attention (currently only
 *  Member Review's pending-match count) — its circle shows a warning icon
 *  instead of the step number; takes precedence over `done` (the two are
 *  never true together in practice, since a pending count is what keeps
 *  `done` false in the first place). `warningCount` is how many items that
 *  `warning` covers (Member Review's unresolved-match count) — the wizard
 *  stepper only shows the icon, but the Home dashboard banner
 *  (entrypoints/app/views/dashboard.ts) uses it for its "Review Needed (N
 *  items)" badge and the "(N)" suffix on its tracker step. `locked` is
 *  orthogonal to `disabled`:
 *  it marks a step the current profile has never reached yet (see
 *  shared/stepper-info.ts's markStepVisited()/getVisitedSteps()) — rendered
 *  identically to `disabled` (inert, non-navigable), but tracked separately
 *  because renderStepFooter()'s Next button below must keep reading the
 *  *un-mixed* `disabled` (prerequisite-only) to stay clickable on a step
 *  that's `locked` by definition the first time it's reached. */
export interface StepMeta {
  info?: string;
  disabled?: boolean;
  done?: boolean;
  warning?: boolean;
  warningCount?: number;
  locked?: boolean;
}
export type StepperInfo = Partial<Record<AppShellPage, StepMeta>>;

// A `locked` step (never visited yet — see shared/stepper-info.ts's
// getVisitedSteps()) always shows its plain step number, even if `warning`/
// `done` would otherwise apply: those reflect review state the user hasn't
// seen yet, and surfacing them before the user has ever reached the step
// would change what the step displays before they got there themselves.
function circleGlyph(index: number, meta: StepMeta | undefined): string {
  if (meta?.locked) return String(index + 1);
  if (meta?.warning) return warningIconHtml("Pending reviews");
  if (meta?.done) return "&#10003;";
  return String(index + 1);
}

function circleClass(meta: StepMeta | undefined): string {
  if (meta?.locked) return "";
  if (meta?.warning) return " warning";
  if (meta?.done) return " completed";
  return "";
}

// A locked (never-visited) step shows no info line either, for the same
// reason circleGlyph()/circleClass() suppress warning/done above — the
// count/status it'd report reflects state the user hasn't navigated to yet.
function visibleInfo(meta: StepMeta | undefined): string | undefined {
  if (meta?.locked) return undefined;
  return meta?.info;
}

// The rail (circle + connecting line) + body (label + info) markup shared by
// both renderAppShell()'s steps and renderVerticalStepper()'s — the same
// nesting the popup's vertical stepper has always used. renderAppShell()'s
// own desktop CSS collapses .app-stepper__rail/__body back to `display:
// contents` (see shared/styles.css) so this extra nesting is invisible at
// that width; at mobile/tablet width (and always, for the popup's vertical
// variant) it's what draws the connecting line between circles and stacks
// the bold label above the lighter info line, matching the popup's look —
// see shared/styles.css's mobile ".app-stepper:not(.app-stepper--vertical)"
// block.
// `alwaysShowInfo` (renderVerticalStepper only) renders an empty
// .app-stepper__info span even with no info text, since the popup's fixed-
// height rows rely on every step reserving that line's space for alignment;
// renderAppShell() omits the element entirely when there's nothing to show,
// since its steps have no such alignment requirement across siblings.
function stepBody(item: (typeof NAV_ITEMS)[number], index: number, meta: StepMeta | undefined, alwaysShowInfo = false): string {
  const infoText = visibleInfo(meta);
  const infoHtml = alwaysShowInfo
    ? `<span class="app-stepper__info">${escapeHtml(infoText ?? "")}</span>`
    : infoText
      ? `<span class="app-stepper__info">${escapeHtml(infoText)}</span>`
      : "";
  return `
      <span class="app-stepper__rail">
        <span class="app-stepper__circle${circleClass(meta)}">${circleGlyph(index, meta)}</span>
        <span class="app-stepper__line"></span>
      </span>
      <span class="app-stepper__body">
        <span class="app-stepper__label">${escapeHtml(item.label)}</span>
        ${infoHtml}
      </span>
    `;
}

export interface AppShellOptions {
  /** `null` for routes outside the wizard — the Home dashboard, Global
   *  Settings, the Excel exporter, Club Progress — so no step renders as
   *  "active" there (see `settingsActive` below for how Global Settings
   *  highlights itself instead). */
  active: AppShellPage | null;
  /** Omit while the info is still loading — steps render without their info
   *  line rather than with a placeholder. */
  info?: StepperInfo;
  /** True only on the Global Settings page itself, to highlight the header
   *  gear icon the same way a wizard step highlights its own circle when
   *  active. */
  settingsActive?: boolean;
  /** Defaults to true. Set false for the standalone Home dashboard
   *  (entrypoints/app/views/dashboard.ts), which is not part of the wizard
   *  flow and renders its own progress banner instead — so the horizontal
   *  wizard stepper is omitted entirely, leaving just the branded header. */
  showStepper?: boolean;
  /** Active-profile label for the header context chip (e.g. "Demo" or
   *  "Continental Europe (tmclub.eu)"), from shared/settings-store.ts's
   *  formatProfileLabel(). Omit to hide the chip (e.g. a caller that hasn't
   *  loaded settings yet). The chip links to Setup. */
  profileLabel?: string;
  /** Privacy Mode (Anonymize) state for the header toggle. Omit to hide the
   *  toggle. entrypoints/app/main.ts wires its change event via a delegated
   *  listener on #appShell (this file stays browser.*-free / listener-free). */
  anonymize?: boolean;
  /** Running version + unread state + latest changelog entry for the header
   *  version badge and its release-notes popover (see renderVersionBadge
   *  below). Built by shared/whats-new-badge.ts's loadVersionBadgeState();
   *  entrypoints/app/main.ts passes it on every route. Omit to hide the badge
   *  entirely (e.g. a caller that hasn't loaded it yet). */
  versionBadge?: VersionBadgeState;
  /** Show a "← Back to Home" link under the header. entrypoints/app/main.ts
   *  passes `route !== "dashboard"` — the Home hub itself is the one route
   *  that doesn't get it. Plain <a href="#dashboard">, navigated via the
   *  browser's native hashchange event like every other link this file
   *  emits — no click handler needed. Standalone routes (Club Progress,
   *  Download Spreadsheet, Global Settings) have no stepper or step footer,
   *  so this is their only one-click path back to the hub besides the brand
   *  logo; wizard steps keep it too, next to their Previous/Next footer. */
  showBackToHome?: boolean;
}

// The header version badge + its release-notes popover, rendered into the
// right-side actions cluster next to the gear. The badge is a plain <button>
// (its click/dismiss handlers are delegated on #appShell by
// entrypoints/app/main.ts — this file stays listener-free); the popover is
// `hidden` until opened.
//
// Two visual states ("Option B"):
//  - Unread (hasUnread): a high-contrast white pill with a gold sparkle on
//    the left and a pulsing red notification dot on the right.
//  - Read/default: a subtle transparent pill showing just the version string.
// entrypoints/app/main.ts's open handler strips the --unread modifier +
// sparkle + dot the moment the popover opens, so the badge settles into the
// read state without waiting for the next chrome re-render.
function renderVersionBadge(badge: VersionBadgeState | undefined): string {
  if (!badge) return "";

  const sparkleHtml = badge.hasUnread ? sparkleIconHtml() : "";
  const dotHtml = badge.hasUnread
    ? `<span class="version-badge__dot" aria-hidden="true">
          <span class="version-badge__dot-ping"></span>
          <span class="version-badge__dot-core"></span>
        </span>`
    : "";
  const ariaLabel = badge.hasUnread ? "Release notes — unread changes" : "Release notes";

  const entry = badge.latest;
  const popoverBody = entry
    ? `
        <div class="version-popover__head">
          <span class="version-popover__version">Version ${escapeHtml(entry.version)}</span>
          <span class="version-popover__date">${escapeHtml(formatChangelogDate(entry.date))}</span>
        </div>
        <ul class="version-popover__list">
          ${changelogHighlights(entry)
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}
        </ul>`
    : `<p class="version-popover__empty">No release notes available.</p>`;

  return `
      <div class="version-badge-wrap">
        <button type="button" class="version-badge${badge.hasUnread ? " version-badge--unread" : ""}" id="versionBadgeBtn" aria-expanded="false" aria-controls="versionPopover" aria-label="${ariaLabel}">
          ${sparkleHtml}
          <span class="version-badge__text">v${escapeHtml(badge.version)}</span>
          ${dotHtml}
        </button>
        <div class="version-popover" id="versionPopover" role="group" aria-label="Release notes" hidden>
          ${popoverBody}
          <a class="version-popover__footer" href="#whatsNew">View full release history &rarr;</a>
        </div>
      </div>`;
}

export function renderAppShell({
  active,
  info,
  settingsActive,
  showStepper = true,
  profileLabel,
  anonymize,
  versionBadge,
  showBackToHome,
}: AppShellOptions): string {
  const activeIndex = active !== null ? NAV_ITEMS.findIndex((item) => item.key === active) : -1;
  const activeItem = activeIndex >= 0 ? NAV_ITEMS[activeIndex] : null;
  const activeMeta = activeItem ? info?.[activeItem.key] : undefined;
  const activeInfoText = activeItem ? visibleInfo(activeMeta) : undefined;

  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const isActive = active !== null && item.key === active;
    const meta = info?.[item.key];
    const body = stepBody(item, index, meta);
    // The active step always stays a live link even if flagged disabled/
    // locked — you're already on that page, graying it out here would be
    // confusing.
    if ((meta?.disabled || meta?.locked) && !isActive) {
      return `<span class="app-stepper__step disabled" aria-disabled="true">${body}</span>`;
    }
    return `<a href="${item.href}" class="app-stepper__step${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>${body}</a>`;
  }).join("");

  // Mobile/tablet-only accordion header (shared/styles.css hides it above
  // that breakpoint) — collapsed by default, showing just the current step
  // ("Step 4: Member Review • 5 to review"); tapping it reveals the full
  // step list below via a plain CSS class flip on .app-stepper, wired up in
  // entrypoints/app/main.ts (the one caller with a persistent #appShell node
  // to attach a delegated listener to — this file stays browser.*-free and
  // builds markup only, no listeners). "Steps" is a fallback title for any
  // caller that renders the stepper with no active wizard step; every route
  // that currently shows the stepper is a wizard step, so it's unused today.
  const summaryTitle = activeItem ? `Step ${activeIndex + 1}: ${escapeHtml(activeItem.label)}` : "Steps";
  const summaryInfoHtml = activeInfoText ? `<span class="app-stepper__summary-info">${escapeHtml(activeInfoText)}</span>` : "";
  const summaryGlyph = activeItem ? circleGlyph(activeIndex, activeMeta) : "&#8226;";
  const summaryCircleClass = activeItem ? circleClass(activeMeta) : "";

  const stepperHtml = showStepper
    ? `
    <nav class="app-stepper" aria-label="Primary">
      <button type="button" class="app-stepper__summary" aria-expanded="false">
        <span class="app-stepper__circle${summaryCircleClass}">${summaryGlyph}</span>
        <span class="app-stepper__summary-text">
          <strong class="app-stepper__summary-title">${summaryTitle}</strong>
          ${summaryInfoHtml}
        </span>
        <span class="app-stepper__summary-chevron" aria-hidden="true">${chevronIconHtml()}</span>
      </button>
      <div class="app-stepper__list">${stepsHtml}</div>
    </nav>`
    : "";

  // Right-side header cluster: active-profile chip (links to Setup) + Privacy
  // Mode toggle + the gear. Each of the first two is omitted when its value
  // wasn't supplied. The toggle's change event is wired by
  // entrypoints/app/main.ts (delegated on #appShell) — this file only emits
  // markup.
  const profileHtml =
    profileLabel !== undefined
      ? `<a href="#setup" class="app-header__profile" title="Manage in Setup">
        <span class="app-header__profile-label">${escapeHtml(profileLabel)}</span>
        ${chevronIconHtml()}
      </a>`
      : "";
  const backHtml = showBackToHome
    ? `<a href="#dashboard" class="app-header__back">&larr; Back to Home</a>`
    : "";

  const privacyHtml =
    anonymize !== undefined
      ? `<label class="app-header__privacy">
        <input type="checkbox" class="toggle-switch__input" id="appPrivacyToggle" aria-label="Privacy Mode (hide member names)"${anonymize ? " checked" : ""}>
        <span class="toggle-switch" aria-hidden="true"></span>
        <span class="app-header__privacy-lock" aria-hidden="true">🔒</span>
        <span class="app-header__privacy-text">Privacy Mode</span>
      </label>`
      : "";

  return `
    <header class="app-header">
      <a href="#dashboard" class="app-header__brand" aria-label="Home">
        <img class="app-header__logo" src="../icons/default/48.png" width="48" height="48" alt="" />
        <div class="app-header__text">
          <div class="app-header__title">Toastmasters VPE Assistant</div>
          <div class="app-header__subtitle">${GOAL_SUBTITLE}</div>
        </div>
      </a>
      <div class="app-header__actions">
        ${profileHtml}
        ${privacyHtml}
        ${renderVersionBadge(versionBadge)}
        <a href="#globalSettings" class="app-header__settings-btn${settingsActive ? " active" : ""}" title="Global Settings" aria-label="Global Settings">${settingsIconHtml()}</a>
      </div>
    </header>${backHtml}${stepperHtml}
  `;
}

/**
 * The Previous/Next navigation footer shared by the four wizard steps —
 * renders into `<div id="stepFooter">`, right after renderChrome() calls
 * renderAppShell() with the same `info`. Previous (when it exists) is always
 * a live link — the prior step was necessarily already visited to get here.
 * Next (when there's a following step) reads only `disabled` (never `locked`)
 * off the upcoming step's StepMeta: `locked` is *expected* to be true for a
 * step reached for the first time via this very button — see StepMeta's doc
 * comment above. On the *last* step (Member Review) there is no next step —
 * instead a "Complete Setup" button (id `completeSetupBtn`, handled by
 * entrypoints/app/main.ts) marks the wizard finished and returns to the Home
 * dashboard.
 */
export function renderStepFooter(active: AppShellPage, info?: StepperInfo): string {
  const index = NAV_ITEMS.findIndex((item) => item.key === active);
  const prevItem = NAV_ITEMS[index - 1];
  const nextItem = NAV_ITEMS[index + 1];

  const prevHtml = prevItem
    ? `<a href="${prevItem.href}" class="btn btn-secondary step-footer__btn">&larr; Back to ${escapeHtml(prevItem.label)}</a>`
    : "<span></span>"; // flex spacer, keeps Next right-aligned on the first page

  let nextHtml = "";
  if (nextItem) {
    const label = `Continue to ${nextItem.label}`;
    const nextDisabled = !!info?.[nextItem.key]?.disabled;
    // Arrow mirrors Previous's leading "&larr;" — trailing here since Next
    // points the opposite direction, both on the outer edge of their button.
    nextHtml = nextDisabled
      ? `<span class="btn btn-primary step-footer__btn" aria-disabled="true">${escapeHtml(label)} &rarr;</span>`
      : `<a href="${nextItem.href}" class="btn btn-primary step-footer__btn">${escapeHtml(label)} &rarr;</a>`;
  } else if (index === NAV_ITEMS.length - 1) {
    // Last wizard step — finish the wizard and go back to the hub.
    nextHtml = `<a href="#dashboard" id="completeSetupBtn" class="btn btn-primary step-footer__btn">Complete Setup &rarr;</a>`;
  }

  return `<div class="step-footer">${prevHtml}${nextHtml}</div>`;
}

/**
 * The popup's vertical stepper. Read-only: unlike renderAppShell()'s links
 * (in-page hash-fragment navigation within the merged app), these steps are
 * not navigable at all — the popup offers navigation only through its
 * "Open Home" button and "What's New" link. Steps render as plain `<div>`s
 * (no `href`, no `data-page-key`, no click handling) and exist purely to
 * show the user where they are in setup.
 */
export function renderVerticalStepper(info: StepperInfo): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const meta = info[item.key];
    const body = stepBody(item, index, meta, true);
    const stateClass = meta?.disabled || meta?.locked ? " disabled" : "";
    return `<div class="app-stepper__step${stateClass}">${body}</div>`;
  }).join("");

  return `<nav class="app-stepper app-stepper--vertical" aria-label="Setup progress">${stepsHtml}</nav>`;
}
