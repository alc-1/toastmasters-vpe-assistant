// lib/dom-utils.js
//
// Tiny DOM helpers shared across the extension's HTML pages (popup, report,
// members, settings). Loaded via a plain <script> tag, no chrome.* dependency
// — same reasoning as lib/report.js/lib/easyspeak-parser.js: keep this usable
// wherever a Document exists, extension page or not.

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// escapeHtml() alone is only safe for text-node content — innerHTML
// serialization doesn't entity-encode a literal `"`, so interpolating it
// into a double-quoted HTML attribute (e.g. an <option value="...">) could
// break out of the attribute. Use this instead wherever untrusted text
// (scraped member/path names) is written into an attribute value.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// Shared warning-triangle icon (report.js and members.js both flag unmatched
// clubs/conflicts with it) — an inline SVG rather than the "⚠" character,
// since that glyph's triangle-and-exclamation strokes depend entirely on the
// system's emoji font and can blur into an unreadable blob at small/bold
// sizes. Plain vector shapes stay crisp at any size. Callers must define a
// `.warning-icon` CSS rule (size/spacing) in their own page.
function warningIconHtml(title) {
  return `
    <span class="warning-icon" title="${escapeAttr(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960" fill="#EA3323"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm330.5-51.5Q520-263 520-280t-11.5-28.5Q497-320 480-320t-28.5 11.5Q440-297 440-280t11.5 28.5Q463-240 480-240t28.5-11.5ZM440-360h80v-200h-80v200Zm40-100Z"/></svg>
    </span>
  `;
}

// Exposed as globals: loaded via <script> in the extension's HTML pages, and
// via module.exports for standalone Node/jsdom testing — same pattern as
// lib/report.js and lib/easyspeak-parser.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { escapeHtml, escapeAttr, warningIconHtml };
}
