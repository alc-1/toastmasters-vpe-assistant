// src/shared/countdown.ts
//
// Shared "closes automatically in N seconds" countdown behavior for the
// basecamp-auth/easyspeak-done confirmation pages, with a cancel button to
// keep the tab open. Uses browser.tabs.remove() rather than window.close(),
// since window.close() only works on a tab/window a script itself opened via
// window.open() — not one opened via browser.tabs.create() (how these tabs
// are opened, in background/api/basecamp.ts / background/api/easyspeak.ts).
// Each page calling startCountdown() must define #countdownText (the
// sentence, replaced on cancel), #countdown (the number inside it), and
// #cancelBtn.

const COUNTDOWN_SECONDS = 5;

export function startCountdown(): void {
  const countdownEl = document.getElementById("countdown")!;
  const countdownText = document.getElementById("countdownText")!;
  const cancelBtn = document.getElementById("cancelBtn")!;

  let remaining = COUNTDOWN_SECONDS;
  const intervalId = setInterval(async () => {
    remaining -= 1;
    countdownEl.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(intervalId);
      const tab = await browser.tabs.getCurrent();
      if (tab?.id != null) {
        browser.tabs.remove(tab.id);
      }
    }
  }, 1000);

  cancelBtn.addEventListener("click", () => {
    clearInterval(intervalId);
    countdownText.textContent = "Auto-close cancelled — close this tab manually whenever you like.";
    cancelBtn.style.display = "none";
  });
}
