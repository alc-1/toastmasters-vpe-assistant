// src/options/settings.ts
//
// DOM glue for the Setup page: the demo/mock mode toggle and the EasySpeak
// server picker. Both are small, low-cardinality settings edited rarely —
// no live-recompute loop like options/members.ts; each section just
// re-reads its own storage after a write.

import { escapeAttr, escapeHtml } from "../shared/dom-utils";
import { EASYSPEAK_SERVERS, getEasySpeakServer, getMockMode, setEasySpeakServer, setMockMode } from "../shared/settings-store";
import { renderAppShell } from "../shared/app-shell";
import type { EasySpeakServerId } from "../shared/types";

init();

// Keeps this tab in sync if a mock-mode/EasySpeak-server decision is edited
// from another tab while this one stays open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "settings" });

  await refreshMockMode();
  await refreshEasySpeakServer();
}

// ---------------------------------------------------------------------------
// Demo / mock mode
// ---------------------------------------------------------------------------

async function refreshMockMode() {
  const current = await getMockMode();
  document.getElementById("mockModeRoot")!.innerHTML = renderMockModeSection(current);
  attachMockModeHandlers();
}

function renderMockModeSection(current: boolean): string {
  return `
    <div class="add-form">
      <label><input type="checkbox" id="mockModeCheckbox"${current ? " checked" : ""}> Enable demo/mock mode</label>
      <button class="btn btn-primary" data-action="save-mock-mode">Save</button>
      <span class="save-status" id="mockModeStatus" aria-live="polite">Saved.</span>
    </div>
  `;
}

function attachMockModeHandlers() {
  const root = document.getElementById("mockModeRoot")!;
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save-mock-mode"]');
  if (saveBtn) saveBtn.addEventListener("click", onSaveMockMode);

  // Hide the "Saved." confirmation again as soon as the checkbox changes,
  // so it can't misleadingly linger next to an unsaved new choice.
  const checkbox = document.getElementById("mockModeCheckbox");
  if (checkbox) {
    checkbox.addEventListener("change", () => {
      document.getElementById("mockModeStatus")!.classList.remove("visible");
    });
  }
}

async function onSaveMockMode() {
  const checkbox = document.getElementById("mockModeCheckbox") as HTMLInputElement;
  await setMockMode(checkbox.checked);
  document.getElementById("mockModeStatus")!.classList.add("visible");
}

// ---------------------------------------------------------------------------
// EasySpeak server
// ---------------------------------------------------------------------------

async function refreshEasySpeakServer() {
  const current = await getEasySpeakServer();
  document.getElementById("easyspeakServerRoot")!.innerHTML = renderEasySpeakServerSection(current);
  attachEasySpeakServerHandlers();
}

function renderEasySpeakServerSection(current: EasySpeakServerId): string {
  const options = EASYSPEAK_SERVERS.map((s) => `<option value="${escapeAttr(s.id)}"${s.id === current ? " selected" : ""}>${escapeHtml(s.label)}</option>`).join("");

  return `
    <div class="add-form">
      <label>EasySpeak server: <select id="easyspeakServerSelect">${options}</select></label>
      <button class="btn btn-primary" data-action="save-easyspeak-server">Save</button>
      <span class="save-status" id="easyspeakServerStatus" aria-live="polite">Saved.</span>
    </div>
  `;
}

function attachEasySpeakServerHandlers() {
  const root = document.getElementById("easyspeakServerRoot")!;
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save-easyspeak-server"]');
  if (saveBtn) saveBtn.addEventListener("click", onSaveEasySpeakServer);

  // Hide the "Saved." confirmation again as soon as the selection changes,
  // so it can't misleadingly linger next to an unsaved new choice.
  const select = document.getElementById("easyspeakServerSelect");
  if (select) {
    select.addEventListener("change", () => {
      document.getElementById("easyspeakServerStatus")!.classList.remove("visible");
    });
  }
}

async function onSaveEasySpeakServer() {
  const select = document.getElementById("easyspeakServerSelect") as HTMLSelectElement;
  await setEasySpeakServer(select.value as EasySpeakServerId);
  document.getElementById("easyspeakServerStatus")!.classList.add("visible");
}
