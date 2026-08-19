// src/shared/app-shell.ts
//
// Single source of truth for the branded header + stepper nav shared by the
// five options pages (Setup, Sync Data, Club Review, Member Review, Club
// Progress). Rendered via innerHTML into a `<div id="appShell">` placeholder,
// matching this codebase's existing plain-template style — no framework, no
// partial-file includes (HTML has none), so a shared TS function is what
// stands in for a "layout component" here.
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

import { chevronIconHtml, documentIconHtml, escapeHtml, settingsIconHtml, warningIconHtml } from "./dom-utils";

export type AppShellPage = "report" | "members" | "setup" | "syncData" | "clubReview";

// Display order, left to right: Setup, Sync Data, Club Review, Member
// Review, Club Progress. Exported so the popup's vertical stepper
// (renderVerticalStepper below) shares the exact same label/order as this
// horizontal one instead of maintaining its own copy — href values are hash
// fragments (e.g. "#setup") resolved by entrypoints/app/router.ts within
// the single merged app.html, which is meaningless from the popup; the
// popup instead opens each step in a new tab directly via
// browser.tabs.create()/shared/pages.ts's appRouteUrl(), ignoring these
// hrefs entirely.
export const NAV_ITEMS: { key: AppShellPage; label: string; href: string; nextCta?: string }[] = [
  { key: "setup", label: "Setup", href: "#setup" },
  { key: "syncData", label: "Sync Data", href: "#syncData" },
  { key: "clubReview", label: "Club Review", href: "#clubReview" },
  { key: "members", label: "Member Review", href: "#members" },
  // nextCta overrides the generic "Continue to X" label used by
  // renderStepFooter() below — "View" reads better than "Continue to" for
  // the destination page itself.
  { key: "report", label: "Club Progress", href: "#report", nextCta: "View Club Progress" },
];

const GOAL_SUBTITLE =
  "Get a clear view of your club's progress by bringing EasySpeak and Basecamp data together in one place.";

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
 *  `done` false in the first place). `locked` is orthogonal to `disabled`:
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
  locked?: boolean;
}
export type StepperInfo = Partial<Record<AppShellPage, StepMeta>>;

// Club Progress (the "report" step) always shows a fixed document icon
// instead of its number/checkmark/warning, regardless of state — it's the
// destination page, not something with its own pass/fail condition the way
// the other four steps have.
//
// A `locked` step (never visited yet — see shared/stepper-info.ts's
// getVisitedSteps()) always shows its plain step number, even if `warning`/
// `done` would otherwise apply: those reflect review state the user hasn't
// seen yet, and surfacing them before the user has ever reached the step
// would change what the step displays before they got there themselves.
function circleGlyph(item: (typeof NAV_ITEMS)[number], index: number, meta: StepMeta | undefined): string {
  if (item.key === "report") return documentIconHtml("Club Progress");
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
        <span class="app-stepper__circle${circleClass(meta)}">${circleGlyph(item, index, meta)}</span>
        <span class="app-stepper__line"></span>
      </span>
      <span class="app-stepper__body">
        <span class="app-stepper__label">${escapeHtml(item.label)}</span>
        ${infoHtml}
      </span>
    `;
}

export interface AppShellOptions {
  /** `null` for the Global Settings page — it isn't one of the five wizard
   *  steps, so no step should render as "active" there (see `settingsActive`
   *  below for how that page highlights itself instead). */
  active: AppShellPage | null;
  /** Omit while the info is still loading — steps render without their info
   *  line rather than with a placeholder. */
  info?: StepperInfo;
  /** True only on the Global Settings page itself, to highlight the header
   *  gear icon the same way a wizard step highlights its own circle when
   *  active. */
  settingsActive?: boolean;
}

export function renderAppShell({ active, info, settingsActive }: AppShellOptions): string {
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
  // ("Step 5: Club Progress • 6 members ready"); tapping it reveals the full
  // step list below via a plain CSS class flip on .app-stepper, wired up in
  // entrypoints/app/main.ts (the one caller with a persistent #appShell node
  // to attach a delegated listener to — this file stays browser.*-free and
  // builds markup only, no listeners). "Steps" is the fallback title on
  // Global Settings, which isn't one of the five wizard steps and so has no
  // "current step" of its own to summarize.
  const summaryTitle = activeItem ? `Step ${activeIndex + 1}: ${escapeHtml(activeItem.label)}` : "Steps";
  const summaryInfoHtml = activeInfoText ? `<span class="app-stepper__summary-info">${escapeHtml(activeInfoText)}</span>` : "";
  const summaryGlyph = activeItem ? circleGlyph(activeItem, activeIndex, activeMeta) : "&#8226;";
  const summaryCircleClass = activeItem ? circleClass(activeMeta) : "";

  return `
    <header class="app-header">
      <div class="app-header__brand">
        <img class="app-header__logo" src="../icons/default/48.png" width="48" height="48" alt="" />
        <div class="app-header__text">
          <div class="app-header__title">Toastmasters VPE Assistant</div>
          <div class="app-header__subtitle">${GOAL_SUBTITLE}</div>
        </div>
      </div>
      <a href="#globalSettings" class="app-header__settings-btn${settingsActive ? " active" : ""}" title="Global Settings" aria-label="Global Settings">${settingsIconHtml()}</a>
    </header>
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
    </nav>
  `;
}

/**
 * The Next/Previous navigation footer shared by all five options pages —
 * renders into a page's own `<div id="stepFooter">` placeholder, right
 * after that page calls renderAppShell() with the same `info`. Previous
 * (when it exists) is always a live link — the prior step was necessarily
 * already visited to get here. Next (when it exists) reads only `disabled`
 * (never `locked`) off the upcoming step's StepMeta: `locked` is *expected*
 * to be true for a step reached for the first time via this very button —
 * see StepMeta's doc comment above.
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
    const label = nextItem.nextCta ?? `Continue to ${nextItem.label}`;
    const nextDisabled = !!info?.[nextItem.key]?.disabled;
    // Arrow mirrors Previous's leading "&larr;" — trailing here since Next
    // points the opposite direction, both on the outer edge of their button.
    nextHtml = nextDisabled
      ? `<span class="btn btn-primary step-footer__btn" aria-disabled="true">${escapeHtml(label)} &rarr;</span>`
      : `<a href="${nextItem.href}" class="btn btn-primary step-footer__btn">${escapeHtml(label)} &rarr;</a>`;
  }

  return `<div class="step-footer">${prevHtml}${nextHtml}</div>`;
}

/**
 * The popup's vertical stepper. Unlike renderAppShell()'s links (in-page
 * hash-fragment navigation within the merged app), a popup click must open a
 * tab instead of navigating the popup document itself — so steps are
 * rendered as inert `href="#"` anchors tagged `data-page-key`, and the
 * caller (entrypoints/popup/main.ts) wires up the actual
 * browser.tabs.create() click handling, which this browser.*-free file must
 * not do directly.
 */
export function renderVerticalStepper(info: StepperInfo): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const meta = info[item.key];
    const body = stepBody(item, index, meta, true);
    // No data-page-key on a disabled/locked step, so the popup's delegated
    // click handler (which only matches "[data-page-key]") simply never
    // fires for it.
    if (meta?.disabled || meta?.locked) {
      return `<span class="app-stepper__step disabled" aria-disabled="true">${body}</span>`;
    }
    return `<a href="#" class="app-stepper__step" data-page-key="${item.key}">${body}</a>`;
  }).join("");

  return `<nav class="app-stepper app-stepper--vertical" aria-label="More">${stepsHtml}</nav>`;
}
