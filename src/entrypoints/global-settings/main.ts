// src/entrypoints/global-settings/main.ts
//
// DOM glue for the Global Settings page — reached via the header gear icon
// (shared/app-shell.ts's renderAppShell()), not one of the five wizard steps
// (see shared/app-shell.ts's NAV_ITEMS): no markStepVisited()/
// renderStepFooter() call, and renderAppShell() is called with `active:
// null` so none of the wizard's step circles render as "current" here.
// Currently just the Anonymize Mode toggle (shared/settings-store.ts's
// getAnonymizeMode()/setAnonymizeMode()) — a natural home for future
// cross-cutting preferences that aren't tied to a specific wizard step.

import { getAnonymizeMode, setAnonymizeMode } from "../../shared/settings-store";
import { renderAppShell } from "../../shared/app-shell";
import { computeStepperInfo } from "../../shared/stepper-info";

init();

// Keeps this tab in sync if the setting is changed from another tab.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  // Still needed even though this page isn't a wizard step itself: the
  // shared header renders the full 5-step nav regardless of which page
  // called it, and that nav's disabled/done/locked state comes from here.
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: null, info: stepperInfo, settingsActive: true });

  const anonymize = await getAnonymizeMode();
  render(anonymize);
}

function render(anonymize: boolean) {
  document.getElementById("anonymizeSectionRoot")!.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-header__title">Anonymize Mode</span></div>
      <div class="card-body">
        <label class="toggle-row">
          <input type="checkbox" id="anonymizeModeToggle"${anonymize ? " checked" : ""}>
          Replace member and club names with generic labels
        </label>
        <p class="help-text">Useful to generate statistics with AI while protecting personal data.</p>
        <p class="help-text">
          While on, Club Progress, the Excel export, and the Sync Data raw-data preview all show
          only generic labels ("Member 1", "Club 1"...) instead of real names.
        </p>
        <p class="help-text">
          Member Review and Club Review become unavailable during that time, since matching
          people/clubs by name doesn't work on anonymized data. Finish reviewing matches first,
          then turn this on before sharing.
        </p>
      </div>
    </div>
  `;

  document.getElementById("anonymizeModeToggle")!.addEventListener("change", async (e) => {
    await setAnonymizeMode((e.target as HTMLInputElement).checked);
  });
}
