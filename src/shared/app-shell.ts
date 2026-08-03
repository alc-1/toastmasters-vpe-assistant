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

import { escapeHtml } from "./dom-utils";

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

/** One line of contextual info shown under a step's label — e.g. "12 clubs
 *  followed" under Club Review. Computed by shared/stepper-info.ts's
 *  computeStepperInfo() and shared verbatim by both renderAppShell() and
 *  renderVerticalStepper() below. Plain text, escaped by each renderer. */
export type StepperInfo = Partial<Record<AppShellPage, string>>;

export interface AppShellOptions {
  active: AppShellPage;
  /** Omit while the info is still loading — steps render without their info
   *  line rather than with a placeholder. */
  info?: StepperInfo;
}

export function renderAppShell({ active, info }: AppShellOptions): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const isActive = item.key === active;
    const infoText = info?.[item.key];
    return `<a href="${item.href}" class="app-stepper__step${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>
        <span class="app-stepper__circle">${index + 1}</span>
        <span class="app-stepper__label">${item.label}</span>
        ${infoText ? `<span class="app-stepper__info">${escapeHtml(infoText)}</span>` : ""}
      </a>`;
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
    const infoText = info[item.key] ?? "";
    return `<a href="#" class="app-stepper__step" data-page-key="${item.key}">
        <span class="app-stepper__rail">
          <span class="app-stepper__circle">${index + 1}</span>
          <span class="app-stepper__line"></span>
        </span>
        <span class="app-stepper__body">
          <span class="app-stepper__label">${escapeHtml(item.label)}</span>
          <span class="app-stepper__info">${escapeHtml(infoText)}</span>
        </span>
      </a>`;
  }).join("");

  return `<nav class="app-stepper app-stepper--vertical" aria-label="More">${stepsHtml}</nav>`;
}
