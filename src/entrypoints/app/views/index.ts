// src/entrypoints/app/views/index.ts
//
// Route -> ViewModule registry consumed by entrypoints/app/main.ts's router.

import type { AppRoute } from "../../../shared/pages";
import type { ViewModule } from "../../../shared/view";
import { dashboardView } from "./dashboard";
import { reportView } from "./report";
import { membersView } from "./members";
import { setupView } from "./setup";
import { syncDataView } from "./syncData";
import { clubReviewView } from "./clubReview";
import { exporterView } from "./exporter";
import { globalSettingsView } from "./globalSettings";

export const VIEWS: Record<AppRoute, ViewModule> = {
  dashboard: dashboardView,
  report: reportView,
  members: membersView,
  setup: setupView,
  syncData: syncDataView,
  clubReview: clubReviewView,
  exporter: exporterView,
  globalSettings: globalSettingsView,
};
