// src/shared/countdown.ts
//
// Shared "closes automatically in N seconds" countdown behavior for the
// basecamp-auth/easyspeak-done/clubcentral-done confirmation pages, with a
// cancel button to keep the tab open. Uses browser.tabs.remove() rather than
// window.close(), since window.close() only works on a tab/window a script
// itself opened via window.open() — not one opened via browser.tabs.create()
// (how these tabs are opened, in background/api/basecamp.ts /
// background/api/easyspeak.ts / background/api/clubcentral.ts).
// Each page calling startCountdown() must define #countdownText and
// #cancelBtn. The whole "closes in N seconds" sentence is regenerated each
// tick via i18n.t()'s pluralized common.countdown.autoClose.count — so
// there's no separate #countdown span to keep in sync.

const COUNTDOWN_SECONDS = 5;

export function startCountdown(): void {
  const countdownText = document.getElementById("countdownText")!;
  const cancelBtn = document.getElementById("cancelBtn")!;

  let remaining = COUNTDOWN_SECONDS;
  countdownText.textContent = i18n.t("common.countdown.autoClose.count", remaining);

  const intervalId = setInterval(async () => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(intervalId);
      const tab = await browser.tabs.getCurrent();
      if (tab?.id != null) {
        browser.tabs.remove(tab.id);
      }
      return;
    }
    countdownText.textContent = i18n.t("common.countdown.autoClose.count", remaining);
  }, 1000);

  cancelBtn.addEventListener("click", () => {
    clearInterval(intervalId);
    countdownText.textContent = i18n.t("common.countdown.cancelled.body");
    cancelBtn.style.display = "none";
  });
}
