// src/background/index.preview.ts
//
// manifest.preview.json's background.service_worker entry — NOT
// manifest.store.json's, which still points at plain ./index.ts. This is a
// physically separate file, not a runtime flag inside index.ts, specifically
// so the store build's bundle graph never reaches update-checker.ts (and
// therefore never contains the GitHub Releases API host string, verified by
// .github/workflows/ci.yml's grep step) — Rollup only includes what a
// target's own manifest-declared entry actually imports.
//
// `import "./index"` runs the exact same onInstalled/registerMessageHandlers
// setup the store build gets; registerUpdateChecker() adds the preview-only
// alarm/notification listeners on top, synchronously, so they're reliably
// registered during the service worker's initial evaluation (see
// background/api/update-checker.ts's header comment for why that ordering
// matters under MV3).

import "./index";
import { registerUpdateChecker } from "./api/update-checker";

registerUpdateChecker();
