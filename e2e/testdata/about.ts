export const aboutData = {
	pageTitle: "About",
	pageDescription: "Check the app version, manage updates, and find application logs.",
	betaBadgeLabel: "Beta",
	// Semver with an optional prerelease tag, e.g. `0.1.13-preview-261019-10491`.
	versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
	// The e2e build has no update feed; Linux has no auto-updater at all.
	updatesUnavailablePattern:
		/^(?:(?:Stable|Preview) updates are not configured for this build|Automatic updates are not available on this platform)\.$/,
	checkForUpdatesLabel: "Check for updates",
	updateTrackTitle: "Update track",
	updateTrackDescription: "Use stable releases or preview builds.",
	updateTrackValuePattern: /^(?:Stable|Preview)$/,
	supportTitle: "Support",
	supportDescription: "Information to include when you contact support.",
	applicationLogsTitle: "Application logs",
	kiloConfigTitle: "Kilo config",
} as const;
