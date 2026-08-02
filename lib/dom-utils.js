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
