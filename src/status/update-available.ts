// src/status/update-available.ts
//
// Deliberately does NOT reuse status/countdown.ts's auto-close: this page has
// numbered reload/reinstall instructions the user needs to actually read, so
// it stays open until the "Got it" button closes it manually — unlike
// basecamp-auth.html/easyspeak-done.html, which are purely informational.

const version = new URLSearchParams(location.search).get("v");
if (version) {
  document.getElementById("title")!.textContent = `Update downloaded: v${version}`;
}

document.getElementById("closeBtn")!.addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
});
