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

import { documentIconHtml, escapeHtml, warningIconHtml } from "./dom-utils";

export type AppShellPage = "report" | "members" | "settings" | "syncData" | "clubReview";

// Display order, left to right: Setup, Sync Data, Club Review, Member
// Review, Club Progress. Exported so the popup's vertical stepper
// (renderVerticalStepper below) shares the exact same label/order as this
// horizontal one instead of maintaining its own copy — the href values here
// are relative to an options page's own directory (e.g. "settings.html"),
// which is meaningless from the popup; the popup resolves navigation itself
// via shared/pages.ts's PAGES + chrome.tabs.create instead of these hrefs.
export const NAV_ITEMS: { key: AppShellPage; label: string; href: string; nextCta?: string }[] = [
  { key: "settings", label: "Setup", href: "settings.html" },
  { key: "syncData", label: "Sync Data", href: "sync-data.html" },
  { key: "clubReview", label: "Club Review", href: "club-review.html" },
  { key: "members", label: "Member Review", href: "members.html" },
  // nextCta overrides the generic "Continue to X" label used by
  // renderStepFooter() below — "View" reads better than "Continue to" for
  // the destination page itself.
  { key: "report", label: "Club Progress", href: "report.html", nextCta: "View Club Progress" },
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

export interface AppShellOptions {
  active: AppShellPage;
  /** Omit while the info is still loading — steps render without their info
   *  line rather than with a placeholder. */
  info?: StepperInfo;
}

export function renderAppShell({ active, info }: AppShellOptions): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const isActive = item.key === active;
    const meta = info?.[item.key];
    const infoText = visibleInfo(meta);
    const body = `
        <span class="app-stepper__circle${circleClass(meta)}">${circleGlyph(item, index, meta)}</span>
        <span class="app-stepper__label">${item.label}</span>
        ${infoText ? `<span class="app-stepper__info">${escapeHtml(infoText)}</span>` : ""}
      `;
    // The active step always stays a live link even if flagged disabled/
    // locked — you're already on that page, graying it out here would be
    // confusing.
    if ((meta?.disabled || meta?.locked) && !isActive) {
      return `<span class="app-stepper__step disabled" aria-disabled="true">${body}</span>`;
    }
    return `<a href="${item.href}" class="app-stepper__step${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>${body}</a>`;
  }).join("");

  return `
    <header class="app-header">
      <div class="app-header__brand">
        <img class="app-header__logo" src="../icons/default/48.png" width="48" height="48" alt="" />
        <div class="app-header__text">
          <div class="app-header__title">Toastmasters VPE Assistant</div>
          <div class="app-header__subtitle">${GOAL_SUBTITLE}</div>
        </div>
      </div>
    </header>
    <nav class="app-stepper" aria-label="Primary">${stepsHtml}</nav>
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
 * The popup's vertical stepper. Unlike renderAppShell()'s links (relative
 * hrefs meant for options-page-to-options-page navigation), a popup click
 * must open a full tab instead of navigating the popup document itself — so
 * steps are rendered as inert `href="#"` anchors tagged `data-page-key`, and
 * the caller (entrypoints/popup/main.ts) wires up the actual browser.tabs.create()
 * click handling via shared/pages.ts, which this browser.*-free file must not
 * import directly.
 */
export function renderVerticalStepper(info: StepperInfo): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const meta = info[item.key];
    const infoText = visibleInfo(meta) ?? "";
    const body = `
        <span class="app-stepper__rail">
          <span class="app-stepper__circle${circleClass(meta)}">${circleGlyph(item, index, meta)}</span>
          <span class="app-stepper__line"></span>
        </span>
        <span class="app-stepper__body">
          <span class="app-stepper__label">${escapeHtml(item.label)}</span>
          <span class="app-stepper__info">${escapeHtml(infoText)}</span>
        </span>
      `;
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
