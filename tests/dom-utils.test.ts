import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// escapeHtml/escapeAttr build a throwaway <div> via `document.createElement`,
// so a global `document` must exist before those functions are called. Safe
// to assign after the static import below — ESM imports only hoist the
// binding, not top-level side effects that touch `document` (dom-utils.ts
// doesn't touch it until a function is actually invoked).
(globalThis as unknown as { document: Document }).document = new JSDOM("<!DOCTYPE html><html><body></body></html>").window
  .document as unknown as Document;

import { escapeHtml, escapeAttr, warningIconHtml } from "../src/shared/dom-utils";

describe("escapeHtml", () => {
  it("entity-encodes text-node-unsafe characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not escape a literal double quote", () => {
    // Documented limitation: safe for text-node content only, NOT for
    // attribute values (that's what escapeAttr is for).
    expect(escapeHtml('say "hi"')).toBe('say "hi"');
  });
});

describe("escapeAttr", () => {
  it("escapes both HTML and double quotes, safe for an attribute value", () => {
    expect(escapeAttr('say "hi" <b>')).toBe("say &quot;hi&quot; &lt;b&gt;");
  });
});

describe("warningIconHtml", () => {
  it("embeds an escaped title as the tooltip and a warning-icon class", () => {
    const html = warningIconHtml('Club "Riverside" has no counterpart');
    expect(html).toContain("warning-icon");
    expect(html).toContain("Club &quot;Riverside&quot; has no counterpart");
    expect(html).toContain("<svg");
  });
});
