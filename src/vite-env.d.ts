/// <reference types="vite/client" />

// @crxjs/vite-plugin's special import queries for dynamically-injected
// scripts (see src/content/easyspeak-parser.iife.ts's doc comment for why
// `?iife` specifically is required here, not the default `?script`). These
// ambient declarations are a defensive fallback in case @crxjs/vite-plugin's
// own type package doesn't ship equivalents — both resolve to the built
// script's output path as a string, for use in
// chrome.scripting.executeScript({ files: [...] }).
declare module "*?iife" {
  const scriptPath: string;
  export default scriptPath;
}

declare module "*?script" {
  const scriptPath: string;
  export default scriptPath;
}
