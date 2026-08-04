// src/options/settings.ts
//
// DOM glue for the Setup page: a two-option "how do you want to prepare your
// club progress report" step (demo data vs. real club data), with the
// EasySpeak region picker revealed only once "real data" is chosen. Backed
// by shared/settings-store.ts's activeProfile (Demo, or one of the three
// EasySpeak regions) — picking a card/region here is exactly "switch
// profile," and each profile keeps its own extracted data and review
// decisions (see shared/storage.ts) rather than one overwriting another.
//
// Unlike the old explicit-Save-button version, every choice here writes
// through immediately (selecting a card, or the region dropdown once
// visible) — the bottom summary is the confirmation, and "Continue" just
// moves on to the next step once a choice has been made.

import { escapeAttr, escapeHtml } from "../shared/dom-utils";
import { EASYSPEAK_SERVERS, getActiveProfile, getLastEasySpeakRegion, setActiveProfile } from "../shared/settings-store";
import { renderAppShell, renderStepFooter } from "../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../shared/stepper-info";
import type { EasySpeakServerId } from "../shared/types";

// null = no choice made yet (the Setup step's required no-default state).
// Distinguished from getActiveProfile()'s `"demo"`/region results by reading
// its raw `null` case directly rather than resolveActiveProfile()'s
// defaulted result, which collapses "never chosen" into a region.
type DataSourceChoice = "demo" | "real" | null;

init();

// Keeps this tab in sync if the choice is edited from another tab while
// this one stays open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  await markStepVisited("settings");
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "settings", info: stepperInfo });
  document.getElementById("stepFooter")!.innerHTML = renderStepFooter("settings", stepperInfo);

  const profile = await getActiveProfile();
  const choice: DataSourceChoice = profile === null ? null : profile === "demo" ? "demo" : "real";
  const region = profile && profile !== "demo" ? profile : await getLastEasySpeakRegion();
  render(choice, region);
}

function render(choice: DataSourceChoice, region: EasySpeakServerId) {
  renderOptionCards(choice);
  renderRegionSection(choice, region);
  renderSummary(choice, region);
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
  const region = await getLastEasySpeakRegion();
  await setActiveProfile(choice === "demo" ? "demo" : region);
  render(choice, region);
}

// ---------------------------------------------------------------------------
// EasySpeak region — shown only when "Use my club data" is selected
// ---------------------------------------------------------------------------

const REGION_IMAGES: Record<EasySpeakServerId, string> = {
  "tmclub.eu": "../images/continental_europe.png",
  "toastmasterclub.org": "../images/uk_and_ireland.png",
  "easy-speak.org": "../images/rest_of_the_world.png",
};

function renderRegionSection(choice: DataSourceChoice, region: EasySpeakServerId) {
  const root = document.getElementById("regionSectionRoot")!;
  if (choice !== "real") {
    root.innerHTML = "";
    return;
  }

  const cards = EASYSPEAK_SERVERS.map(
    (s) => `
      <label class="region-card${s.id === region ? " selected" : ""}">
        <img class="region-card__image" src="${escapeAttr(REGION_IMAGES[s.id])}" alt="" />
        <span class="region-card__label">
          <input type="radio" name="easyspeakRegion" value="${escapeAttr(s.id)}"${s.id === region ? " checked" : ""}>
          <span class="region-card__text">
            <span class="region-card__region">${escapeHtml(s.region)}</span>
            <span class="region-card__url">${escapeHtml(s.id)}</span>
          </span>
        </span>
      </label>
    `
  ).join("");

  root.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-header__title">EasySpeak region</span></div>
      <div class="card-body">
        <p class="help-text">We'll use this to find your club member progress data.</p>
        <div class="region-cards">${cards}</div>
      </div>
    </div>
  `;

  document.querySelectorAll<HTMLInputElement>('input[name="easyspeakRegion"]').forEach((input) => {
    input.addEventListener("change", () => onChooseRegion(input.value as EasySpeakServerId));
  });
}

async function onChooseRegion(region: EasySpeakServerId) {
  await setActiveProfile(region);
  renderRegionSection("real", region);
  renderSummary("real", region);
}

// ---------------------------------------------------------------------------
// Summary
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
