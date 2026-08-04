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
export const NAV_ITEMS: { key: AppShellPage; label: string; href: string }[] = [
  { key: "settings", label: "Setup", href: "settings.html" },
  { key: "syncData", label: "Sync Data", href: "sync-data.html" },
  { key: "clubReview", label: "Club Review", href: "club-review.html" },
  { key: "members", label: "Member Review", href: "members.html" },
  { key: "report", label: "Club Progress", href: "report.html" },
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
 *  `done` false in the first place). */
export interface StepMeta {
  info?: string;
  disabled?: boolean;
  done?: boolean;
  warning?: boolean;
}
export type StepperInfo = Partial<Record<AppShellPage, StepMeta>>;

// Club Progress (the "report" step) always shows a fixed document icon
// instead of its number/checkmark/warning, regardless of state — it's the
// destination page, not something with its own pass/fail condition the way
// the other four steps have.
function circleGlyph(item: (typeof NAV_ITEMS)[number], index: number, meta: StepMeta | undefined): string {
  if (item.key === "report") return documentIconHtml("Club Progress");
  if (meta?.warning) return warningIconHtml("Pending reviews");
  if (meta?.done) return "&#10003;";
  return String(index + 1);
}

function circleClass(meta: StepMeta | undefined): string {
  if (meta?.warning) return " warning";
  if (meta?.done) return " completed";
  return "";
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
    const infoText = meta?.info;
    const body = `
        <span class="app-stepper__circle${circleClass(meta)}">${circleGlyph(item, index, meta)}</span>
        <span class="app-stepper__label">${item.label}</span>
        ${infoText ? `<span class="app-stepper__info">${escapeHtml(infoText)}</span>` : ""}
      `;
    // The active step always stays a live link even if flagged disabled —
    // you're already on that page, graying it out here would be confusing.
    if (meta?.disabled && !isActive) {
      return `<span class="app-stepper__step disabled" aria-disabled="true">${body}</span>`;
    }
    return `<a href="${item.href}" class="app-stepper__step${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>${body}</a>`;
  }).join("");

  return `
    <header class="app-header">
      <div class="app-header__brand">
        <img class="app-header__logo" src="../icons/icon-48.png" width="48" height="48" alt="" />
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
 * The popup's vertical stepper. Unlike renderAppShell()'s links (relative
 * hrefs meant for options-page-to-options-page navigation), a popup click
 * must open a full tab instead of navigating the popup document itself — so
 * steps are rendered as inert `href="#"` anchors tagged `data-page-key`, and
 * the caller (popup/index.ts) wires up the actual chrome.tabs.create() click
 * handling via shared/pages.ts, which this chrome.*-free file must not
 * import directly.
 */
export function renderVerticalStepper(info: StepperInfo): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const meta = info[item.key];
    const infoText = meta?.info ?? "";
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
    // No data-page-key on a disabled step, so the popup's delegated click
    // handler (which only matches "[data-page-key]") simply never fires for it.
    if (meta?.disabled) {
      return `<span class="app-stepper__step disabled" aria-disabled="true">${body}</span>`;
    }
    return `<a href="#" class="app-stepper__step" data-page-key="${item.key}">${body}</a>`;
  }).join("");

  return `<nav class="app-stepper app-stepper--vertical" aria-label="More">${stepsHtml}</nav>`;
}
