// src/welcome/welcome.ts
//
// DOM glue for the one-time welcome tab opened by background/index.ts's
// onInstalled listener (reason === "install" only, never on update/reload).
// Its only job is pointing a first-time user at the toolbar-pinning step
// Chrome doesn't surface on its own, then handing off to the existing Setup
// step — "Get started" navigates this same tab there rather than opening a
// second one.

import { PAGES, pageUrl } from "../shared/pages";

document.getElementById("pinMockup")!.innerHTML = renderPinMockup();

document.getElementById("getStartedBtn")!.addEventListener("click", () => {
  location.href = pageUrl(PAGES.settings);
});

function renderPinMockup(): string {
  return `
    <div class="toolbar-mock">
      <div class="toolbar-mock__address"></div>
      <div class="toolbar-mock__avatar"></div>
      <div class="toolbar-mock__icon">
        ${puzzlePieceIconHtml()}
        <span class="callout-badge">1</span>
      </div>
    </div>
    <div class="dropdown-mock">
      <div class="dropdown-mock__row">
        <img class="dropdown-mock__logo" src="../icons/default/32.png" alt="" />
        <span class="dropdown-mock__name">Toastmasters VPE Assistant</span>
        <span class="dropdown-mock__pin">
          ${pinIconHtml()}
          <span class="callout-badge">2</span>
        </span>
      </div>
    </div>
  `;
}

function puzzlePieceIconHtml(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H15c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>`;
}

function pinIconHtml(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
}
