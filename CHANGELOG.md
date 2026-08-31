# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
A release with nothing noteworthy for users simply doesn't get an entry.

## [Unreleased]

### Changed

- Club Progress "Next Level Summary" now shows the level each member is currently working on, instead of the last level they completed.

## [2.0.0] - 2026-08-30

### Added

- New Home screen: an overview of your club-data status and quick-access tiles for every tool.
- Save or Restore Club Settings: save a backup file of all your data and settings, and load it back later.
- Pathways Onboarding Helper: a tool listing paid-up members who haven't enrolled in a Pathways path yet.
- What's New: tool version and related changes are made available in the footer of each page.
- Sync Data now includes Toastmasters.org Club Central to enable the Pathways Onboarding Helper.

### Changed

- Installing an update no longer opens the What's New page in a new tab.
- Refreshed the interface to have consistent buttons, toggles, and controls throughout. Firefox 128 or newer is now required.
- Privacy Mode and the active profile are now shown in the top bar on every screen.
- The setup wizard is now four steps, ending at Member Review; Club Progress is reached from a Home screen tile.
- Club Review now shows why the "Continue to Member Review" button is disabled (e.g. "Resolve 2 unmatched clubs to continue").

## [1.2.0] - 2026-08-28

### Added

- Checks regularly if an update is available to install.
- Show what's new whenever an update gets installed.

## [1.1.0] - 2026-08-23

### Added

- Basecamp's official path-completion data now syncs automatically to flag completed paths.

### Fixed

- Orphan clubs (with no counterpart in the other system) are skipped in Member Review and can now
  still reach Club Progress.

## [1.0.0] - 2026-08-19

### Added

- Full mobile/responsive redesign — Club Progress, Sync Data, Club Review, Member Review, and the
  step navigator now all adapt to small screens.
- Now available on the Microsoft Edge Add-ons store, alongside Chrome and Firefox.

## [0.8.1] - 2026-08-16

### Added

- Now available on the Firefox Add-ons store, alongside Chrome.

### Fixed

- The extension now works correctly on Firefox.

## [0.8.0] - 2026-08-15

### Added

- Export the full report to Excel, with a choice of which data to include in the export.
- An Anonymize Mode to hide member names on screen and in exports.

### Changed

- Migrated the wizard steps into a single-page app for faster navigation between steps.
- Moved the path name lookup table from Club Review to a new Global Settings page.

### Fixed

- Unmatched Basecamp club/member names now list first for easier review.
- EasySpeak-only paths no longer show a misleading level for the Basecamp side.

## [0.7.0] - 2026-08-14

### Added

- Now available on the Chrome Web Store, alongside manual installs.
- A search bar to filter the Member Review table by name.
- Tooltips explaining each path's status, plus a projection of the remaining speeches needed.

### Changed

- Reworked the Club Progress detail view for clarity.
- EasySpeak paths now list first in review tables, since Basecamp is the source of truth for path
  actions.

### Fixed

- Multi-path EasySpeak profiles now parse correctly.
- Completed EasySpeak paths no longer trigger unnecessary bind suggestions.

## [0.6.1] - 2026-08-13

### Added

- Club Progress now highlights members who are ready to level up.
- Rows in Club Progress can be expanded/collapsed for more detail.

### Changed

- Reworked the Club Progress table layout and row grouping for easier scanning.

## [0.5.0] - 2026-08-10

### Added

- Preview builds now check for and prompt about newer versions automatically.

### Fixed

- Club Progress no longer shows EasySpeak paths that are already 100% complete.
- Club Progress now separates members still pending review from the rest.
- Unmatched paths are now flagged for review instead of being silently skipped.

## [0.4.0] - 2026-08-06

### Added

- A loading progress indicator while Basecamp data is being fetched.

### Changed

- Reduced the permissions the extension requests (dropped an unnecessary tabs-access permission).

## [0.3.0] - 2026-08-05

### Added

- A welcome page shown the first time the extension is installed, pointing out how to pin it to the
  toolbar.

## [0.2.1] - 2026-08-05

### Added

- Initial release: pulls club progress data from Basecamp and EasySpeak, matches members and paths
  across both systems, and shows a Club Progress report, Member Review, and Club Review for
  reconciling mismatches.
- CSV export of the report.
- A demo mode with sample data.
- Support for switching between EasySpeak regional servers.
