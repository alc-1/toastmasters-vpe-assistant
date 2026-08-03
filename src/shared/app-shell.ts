// src/shared/app-shell.ts
//
// Single source of truth for the branded header + primary nav shared by the
// three options pages (Report, Member Matching, Settings). Rendered via
// innerHTML into a `<div id="appShell">` placeholder, matching this
// codebase's existing plain-template style — no framework, no partial-file
// includes (HTML has none), so a shared TS function is what stands in for a
// "layout component" here.
//
// Each page calls renderAppShell() once on init — the header itself never
// changes after that (no per-page subtitle: Report/Members already show
// the active club as a tab immediately below, so repeating its name here
// would just be redundant).

export type AppShellPage = "report" | "members" | "settings";

const NAV_ITEMS: { key: AppShellPage; label: string; href: string }[] = [
  { key: "report", label: "Club Progress", href: "report.html" },
  { key: "members", label: "Member Review", href: "members.html" },
  { key: "settings", label: "Setup", href: "settings.html" },
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
        <div class="app-header__title">Toastmasters VPE Tracker</div>
      </div>
      <nav class="app-nav" aria-label="Primary">${navHtml}</nav>
    </header>
  `;
}
