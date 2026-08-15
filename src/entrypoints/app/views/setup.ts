// src/entrypoints/app/views/setup.ts
//
// The Setup view: a two-option "how do you want to prepare your club
// progress report" step (demo data vs. real club data), with the EasySpeak
// region picker revealed only once "real data" is chosen. Backed by
// shared/settings-store.ts's activeProfile (Demo, or one of the three
// EasySpeak regions) — picking a card/region here is exactly "switch
// profile," and each profile keeps its own extracted data and review
// decisions (see shared/storage.ts) rather than one overwriting another.
//
// Every choice here writes through immediately (selecting a card, or the
// region dropdown once visible) — the bottom summary is the confirmation.

import { escapeAttr, escapeHtml } from "../../../shared/dom-utils";
import { EASYSPEAK_SERVERS, getActiveProfile, getLastEasySpeakRegion, setActiveProfile } from "../../../shared/settings-store";
import type { EasySpeakServerId } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">Setup</h1>
    <p class="page-intro__desc">Choose how you want to prepare your club progress report.</p>
  </div>

  <div id="optionCardsRoot"></div>
  <div id="regionSectionRoot"></div>
  <div id="summaryRoot"></div>
`;

// null = no choice made yet (the Setup step's required no-default state).
type DataSourceChoice = "demo" | "real" | null;

const REGION_IMAGES: Record<EasySpeakServerId, string> = {
  "tmclub.eu": "/images/continental_europe.png",
  "toastmasterclub.org": "/images/uk_and_ireland.png",
  "easy-speak.org": "/images/rest_of_the_world.png",
};

export const setupView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // Set true by the disposer — guards against init() resuming after an
    // await (e.g. if the user navigates away right as a storage-triggered
    // re-run starts) and writing into #viewRoot content that now belongs
    // to a different, already-mounted view. See syncData.ts's mount() for
    // the full writeup of why this matters.
    let disposed = false;

    async function init() {
      const profile = await getActiveProfile();
      const choice: DataSourceChoice = profile === null ? null : profile === "demo" ? "demo" : "real";
      const region = profile && profile !== "demo" ? profile : await getLastEasySpeakRegion();
      if (disposed) return;
      render(choice, region);
    }

    function render(choice: DataSourceChoice, region: EasySpeakServerId) {
      renderOptionCards(choice);
      renderRegionSection(choice, region);
      renderSummary(choice, region);
    }

    function renderOptionCards(choice: DataSourceChoice) {
      root.querySelector("#optionCardsRoot")!.innerHTML = `
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

      root.querySelectorAll<HTMLInputElement>('input[name="dataSourceChoice"]').forEach((input) => {
        input.addEventListener("change", () => onChooseDataSource(input.value as "demo" | "real"));
      });
    }

    async function onChooseDataSource(choice: "demo" | "real") {
      const region = await getLastEasySpeakRegion();
      await setActiveProfile(choice === "demo" ? "demo" : region);
      if (disposed) return;
      render(choice, region);
    }

    function renderRegionSection(choice: DataSourceChoice, region: EasySpeakServerId) {
      const sectionRoot = root.querySelector("#regionSectionRoot")!;
      if (choice !== "real") {
        sectionRoot.innerHTML = "";
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

      sectionRoot.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-header__title">EasySpeak region</span></div>
          <div class="card-body">
            <p class="help-text">We'll use this to find your club member progress data.</p>
            <div class="region-cards">${cards}</div>
          </div>
        </div>
      `;

      root.querySelectorAll<HTMLInputElement>('input[name="easyspeakRegion"]').forEach((input) => {
        input.addEventListener("change", () => onChooseRegion(input.value as EasySpeakServerId));
      });
    }

    async function onChooseRegion(region: EasySpeakServerId) {
      await setActiveProfile(region);
      if (disposed) return;
      renderRegionSection("real", region);
      renderSummary("real", region);
    }

    function renderSummary(choice: DataSourceChoice, region: EasySpeakServerId) {
      const summaryRoot = root.querySelector("#summaryRoot")!;
      if (choice === null) {
        summaryRoot.innerHTML = "";
        return;
      }

      const regionLabel = EASYSPEAK_SERVERS.find((s) => s.id === region)?.label ?? region;
      const items = choice === "demo" ? ["Demo data selected"] : ["Real club data", `EasySpeak region: ${regionLabel}`];

      summaryRoot.innerHTML = `
        <div class="setup-summary">
          <div class="setup-summary__title">Your setup:</div>
          ${items.map((item) => `<div class="setup-summary__item">✓ ${escapeHtml(item)}</div>`).join("")}
        </div>
      `;
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") init();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await init();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
