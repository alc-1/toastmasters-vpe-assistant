// src/shared/export/download.ts
//
// DOM-only blob download — no exceljs import, no browser.* extension API, so
// this stays reusable if the Excel library ever changes. Deliberately NOT
// browser.downloads.download(): this codebase has documented history (see
// shared/update-store.ts) of that API's downloads being silently cancelled
// by a subsequent focus-stealing browser.tabs.create() call. This approach
// needs no `downloads` permission at all.

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred, not immediate: revoking the object URL synchronously right
  // after click() can race the browser's own async read of the blob in some
  // browsers — a short delay is the standard workaround.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
