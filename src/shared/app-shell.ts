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

export type AppShellPage = "report" | "members" | "settings" | "syncData" | "clubReview";

// Display order, left to right: Setup, Sync Data, Club Review, Member
// Review, Club Progress.
const NAV_ITEMS: { key: AppShellPage; label: string; href: string }[] = [
  { key: "settings", label: "Setup", href: "settings.html" },
  { key: "syncData", label: "Sync Data", href: "sync-data.html" },
  { key: "clubReview", label: "Club Review", href: "club-review.html" },
  { key: "members", label: "Member Review", href: "members.html" },
  { key: "report", label: "Club Progress", href: "report.html" },
];

const GOAL_SUBTITLE =
  "Get a clear view of your club's progress by bringing EasySpeak and Basecamp data together in one place.";

export interface AppShellOptions {
  active: AppShellPage;
}

export function renderAppShell({ active }: AppShellOptions): string {
  const stepsHtml = NAV_ITEMS.map((item, index) => {
    const isActive = item.key === active;
    return `<a href="${item.href}" class="app-stepper__step${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>
        <span class="app-stepper__circle">${index + 1}</span>
        <span class="app-stepper__label">${item.label}</span>
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
