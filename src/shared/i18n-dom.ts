// src/shared/i18n-dom.ts
//
// Small helper for the handful of pages that render as static HTML with no
// other JS-driven text (welcome/, basecamp-auth/, easyspeak-done/,
// clubcentral-done/, plus popup/index.html's 2 static strings) — everywhere
// else, a view/entrypoint builds its own markup as a template literal and
// interpolates i18n.t(...) directly, so this helper isn't needed there.
//
// Uses the WXT-auto-imported `i18n` global (from #i18n) directly, same
// convention as `browser`/`defineBackground` elsewhere in this codebase — no
// import statement. Only called from entrypoints that run inside the real
// extension bundle, never from a Vitest-covered pure module (see
// shared/i18n-pure.ts for that other path).

/**
 * Walks `root` for `[data-i18n]` (sets `.textContent`) and
 * `[data-i18n-attr-*]` (sets the matching attribute — e.g.
 * `data-i18n-attr-title="some.key"` sets `title`,
 * `data-i18n-attr-aria-label="some.key"` sets `aria-label`). Call once per
 * page load, before any other DOM work.
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = i18n.t(key as never);
  });

  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const attr of el.getAttributeNames()) {
      const match = /^data-i18n-attr-(.+)$/.exec(attr);
      if (!match) continue;
      const targetAttr = match[1];
      const key = el.getAttribute(attr);
      if (targetAttr && key) el.setAttribute(targetAttr, i18n.t(key as never));
    }
  });
}
