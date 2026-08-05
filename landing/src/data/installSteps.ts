export const RELEASES_URL = "https://github.com/alc-1/toastmasters-vpe-assistant/releases/latest";
export const ISSUES_URL = "https://github.com/alc-1/toastmasters-vpe-assistant/issues/new/choose";
export const REPO_URL = "https://github.com/alc-1/toastmasters-vpe-assistant";

export const requirements: string[] = [
  "A computer — this is a browser extension, so it won't work on a phone or tablet.",
  "A Chromium-based browser: Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, or Arc.",
  "Officer access at a Toastmasters club — the extension only pulls data for clubs where you're an officer in Basecamp/EasySpeak.",
];

export interface InstallStep {
  step: number;
  description: string;
}

export const installSteps: InstallStep[] = [
  { step: 1, description: "Download the latest release and unzip it." },
  { step: 2, description: "Open chrome://extensions (Chrome won't let a web page link there directly — copy the address and paste it into the address bar)." },
  { step: 3, description: "Enable Developer mode (top right)." },
  { step: 4, description: "Click Load unpacked and select the unzipped folder." },
];
