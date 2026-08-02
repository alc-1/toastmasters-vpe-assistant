// src/status/countdown.ts
//
// Shared "closes automatically in N seconds" countdown behavior for the
// status/*.html confirmation pages, with a cancel button to keep the tab
// open. Uses chrome.tabs.remove() rather than window.close(), since
// window.close() only works on a tab/window a script itself opened via
// window.open() — not one opened via chrome.tabs.create() (how these tabs
// are opened, in background/api/basecamp.ts / background/api/easyspeak.ts).
// Each page including this script must define #countdownText (the
// sentence, replaced on cancel), #countdown (the number inside it), and
// #cancelBtn.

const COUNTDOWN_SECONDS = 5;

function startCountdown() {
  const countdownEl = document.getElementById("countdown")!;
  const countdownText = document.getElementById("countdownText")!;
  const cancelBtn = document.getElementById("cancelBtn")!;

  let remaining = COUNTDOWN_SECONDS;
  const intervalId = setInterval(async () => {
    remaining -= 1;
    countdownEl.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(intervalId);
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id != null) {
        chrome.tabs.remove(tab.id);
      }
    }
  }, 1000);

  cancelBtn.addEventListener("click", () => {
    clearInterval(intervalId);
    countdownText.textContent = "Auto-close cancelled — close this tab manually whenever you like.";
    cancelBtn.style.display = "none";
  });
}

startCountdown();
