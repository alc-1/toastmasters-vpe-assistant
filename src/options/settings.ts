// src/options/settings.ts
//
// DOM glue for the Setup page: a two-option "how do you want to prepare your
// club progress report" step (demo data vs. real club data), with the
// EasySpeak region picker revealed only once "real data" is chosen. Backed
// by the same shared/settings-store.ts mockMode/easyspeakServer values as
// before — this file only changes presentation/flow, not the underlying
// settings or extraction logic.
//
// Unlike the old explicit-Save-button version, every choice here writes
// through immediately (selecting a card, or the region dropdown once
// visible) — the bottom summary is the confirmation, and "Continue" just
// moves on to the next step once a choice has been made.

import { escapeAttr, escapeHtml } from "../shared/dom-utils";
import { EASYSPEAK_SERVERS, getEasySpeakServer, setEasySpeakServer, setMockMode } from "../shared/settings-store";
import { local } from "../shared/storage";
import { renderAppShell } from "../shared/app-shell";
import { computeStepperInfo } from "../shared/stepper-info";
import type { EasySpeakServerId } from "../shared/types";

// null = no choice made yet (the Setup step's required no-default state).
// Distinguished from mockMode's own `false` default by reading the raw
// stored value below instead of settings-store.ts's getMockMode(), which
// collapses "never set" and "explicitly off" into the same `false`.
type DataSourceChoice = "demo" | "real" | null;

init();

document.getElementById("continueBtn")!.addEventListener("click", () => {
  window.location.href = "sync-data.html";
});

// Keeps this tab in sync if the choice is edited from another tab while
// this one stays open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "settings", info: stepperInfo });

  const choice = await readChoice();
  const region = await getEasySpeakServer();
  render(choice, region);
}

async function readChoice(): Promise<DataSourceChoice> {
  const rawMockMode = await local.value("mockMode");
  if (rawMockMode === true) return "demo";
  if (rawMockMode === false) return "real";
  return null;
}

function render(choice: DataSourceChoice, region: EasySpeakServerId) {
  renderOptionCards(choice);
  renderRegionSection(choice, region);
  renderSummary(choice, region);
  renderContinueButton(choice);
}

// ---------------------------------------------------------------------------
// Option cards
// ---------------------------------------------------------------------------

function renderOptionCards(choice: DataSourceChoice) {
  document.getElementById("optionCardsRoot")!.innerHTML = `
    <div class="option-cards">
      <label class="option-card${choice === "demo" ? " selected" : ""}">
        <input type="radio" name="dataSourceChoice" value="demo"${choice === "demo" ? " checked" : ""}>
        <span class="option-card__body">
          <span class="option-card__title">Try with demo data</span>
          <span class="option-card__desc">Explore the tool using sample club information without connecting to your real data.</span>
        </span>
      </label>
      <label class="option-card${choice === "real" ? " selected" : ""}">
        <input type="radio" name="dataSourceChoice" value="real"${choice === "real" ? " checked" : ""}>
        <span class="option-card__body">
          <span class="option-card__title">Use my club data</span>
          <span class="option-card__desc">Load your real member progress from Basecamp and EasySpeak.</span>
        </span>
      </label>
    </div>
  `;

  document.querySelectorAll<HTMLInputElement>('input[name="dataSourceChoice"]').forEach((input) => {
    input.addEventListener("change", () => onChooseDataSource(input.value as "demo" | "real"));
  });
}

async function onChooseDataSource(choice: "demo" | "real") {
  await setMockMode(choice === "demo");
  const region = await getEasySpeakServer();
  render(choice, region);
}

// ---------------------------------------------------------------------------
// EasySpeak region — shown only when "Use my club data" is selected
// ---------------------------------------------------------------------------

function renderRegionSection(choice: DataSourceChoice, region: EasySpeakServerId) {
  const root = document.getElementById("regionSectionRoot")!;
  if (choice !== "real") {
    root.innerHTML = "";
    return;
  }

  const options = EASYSPEAK_SERVERS.map(
    (s) => `<option value="${escapeAttr(s.id)}"${s.id === region ? " selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");

  root.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-header__title">EasySpeak region</span></div>
      <div class="card-body">
        <p class="help-text">We'll use this to find your club member progress data.</p>
        <select id="easyspeakRegionSelect">${options}</select>
      </div>
    </div>
  `;

  document.getElementById("easyspeakRegionSelect")!.addEventListener("change", onChooseRegion);
}

async function onChooseRegion(event: Event) {
  const select = event.target as HTMLSelectElement;
  const region = select.value as EasySpeakServerId;
  await setEasySpeakServer(region);
  renderSummary("real", region);
  renderContinueButton("real");
}

// ---------------------------------------------------------------------------
// Summary + Continue
// ---------------------------------------------------------------------------

function renderSummary(choice: DataSourceChoice, region: EasySpeakServerId) {
  const root = document.getElementById("summaryRoot")!;
  if (choice === null) {
    root.innerHTML = "";
    return;
  }

  const regionLabel = EASYSPEAK_SERVERS.find((s) => s.id === region)?.label ?? region;
  const items =
    choice === "demo" ? ["Demo data selected"] : ["Real club data", `EasySpeak region: ${regionLabel}`];

  root.innerHTML = `
    <div class="setup-summary">
      <div class="setup-summary__title">Your setup:</div>
      ${items.map((item) => `<div class="setup-summary__item">✓ ${escapeHtml(item)}</div>`).join("")}
    </div>
  `;
}

function renderContinueButton(choice: DataSourceChoice) {
  (document.getElementById("continueBtn") as HTMLButtonElement).disabled = choice === null;
}
