// src/shared/app-shell.ts
//
// Single source of truth for the branded header + primary nav shared by the
// five options pages (Setup, Sync Data, Club Review, Member Review, Club
// Progress). Rendered via innerHTML into a `<div id="appShell">` placeholder,
// matching this codebase's existing plain-template style — no framework, no
// partial-file includes (HTML has none), so a shared TS function is what
// stands in for a "layout component" here.
//
// Each page calls renderAppShell() once on init — the header itself never
// changes after that (no per-page subtitle: Club Progress/Member Review
// already show the active club as a tab immediately below, so repeating its
// name here would just be redundant).

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

export interface AppShellOptions {
  active: AppShellPage;
}

export function renderAppShell({ active }: AppShellOptions): string {
  const navHtml = NAV_ITEMS.map((item) => {
    const isActive = item.key === active;
    return `<a href="${item.href}" class="app-nav__link${isActive ? " active" : ""}"${isActive ? ' aria-current="page"' : ""}>${item.label}</a>`;
  }).join("");

  return `
    <header class="app-header">
      <div class="app-header__brand">
        <div class="app-header__title">Toastmasters VPE Assistant</div>
      </div>
      <nav class="app-nav" aria-label="Primary">${navHtml}</nav>
    </header>
  `;
}
