import { applyI18n } from "../../shared/i18n-dom";
import { startCountdown } from "../../shared/countdown";
import { initLocaleOverride } from "../../shared/i18n-override";

await initLocaleOverride();
applyI18n();
startCountdown();
