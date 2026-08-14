// src/shared/dom-utils.ts
//
// Tiny DOM helpers shared across the extension's HTML pages (popup, report,
// members, settings). No chrome.* dependency — usable wherever a Document
// exists, extension page or not (see tests/dom-utils.test.ts).

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// escapeHtml() alone is only safe for text-node content — innerHTML
// serialization doesn't entity-encode a literal `"`, so interpolating it
// into a double-quoted HTML attribute (e.g. an <option value="...">) could
// break out of the attribute. Use this instead wherever untrusted text
// (scraped member/path names) is written into an attribute value.
export function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// Shared warning-triangle icon (report.ts and members.ts both flag unmatched
// clubs/conflicts with it) — an inline SVG rather than the "⚠" character,
// since that glyph's triangle-and-exclamation strokes depend entirely on the
// system's emoji font and can blur into an unreadable blob at small/bold
// sizes. Plain vector shapes stay crisp at any size. No `fill` attribute
// here — shared/styles.css's `.warning-icon svg` rule sets it from a token,
// so this icon's color stays in sync with the rest of the danger palette.
// Callers must define a `.warning-icon` CSS rule (size/spacing) in their own
// page (already true of shared/styles.css itself for report.ts/members.ts).
export function warningIconHtml(title: string): string {
  return `
    <span class="warning-icon" title="${escapeAttr(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm330.5-51.5Q520-263 520-280t-11.5-28.5Q497-320 480-320t-28.5 11.5Q440-297 440-280t11.5 28.5Q463-240 480-240t28.5-11.5ZM440-360h80v-200h-80v200Zm40-100Z"/></svg>
    </span>
  `;
}

// Used by Club Progress's per-path levels table (report.ts) to mark a level
// Basecamp has approved. Fixed fill (like warningIconHtml above, unlike
// documentIconHtml's currentColor) since this is always the same "approved"
// green regardless of context. The svg itself is aria-hidden — the wrapping
// span's title/aria-label is what screen readers announce instead.
export function approvedCheckIconHtml(title: string): string {
  return `
    <span class="approved-check" role="img" aria-label="${escapeAttr(title)}" title="${escapeAttr(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" aria-hidden="true"><path fill="#157F5B" d="M10 0a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 8-8 8.01 8.01 0 0 1-8 8m4.59-12.42L8 12.17 5.41 9.59 4 11l4 4 8-8z"></path></svg>
    </span>
  `;
}

// Used by the Club Progress stepper step, which always shows this instead of
// its step number/checkmark regardless of state — see shared/app-shell.ts.
// stroke="currentColor" (not a fixed fill, unlike warningIconHtml above) so
// it inherits whatever color its container already sets (e.g. the stepper
// circle's active/completed color) instead of needing its own CSS override.
export function documentIconHtml(title: string): string {
  return `
    <span class="document-icon" title="${escapeAttr(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
    </span>
  `;
}
