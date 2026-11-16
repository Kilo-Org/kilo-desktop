export const aboutData = {
	pageTitle: "About",
	pageDescription: "Check the app version, manage updates, and find application logs.",
	// Semver with an optional prerelease tag, e.g. `0.1.13-preview-261019-10491`.
	versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
	// The e2e build has no update host compiled in, on any platform.
	updatesUnavailablePattern: /^(?:Stable|Preview) updates are not configured for this build\.$/,
	checkForUpdatesLabel: "Check for updates",
	updateTrackTitle: "Update track",
	updateTrackDescription: "Use stable releases or preview builds.",
	updateTrackValuePattern: /^(?:Stable|Preview)$/,
	supportTitle: "Support",
	supportDescription: "Information to include when you contact support.",
	applicationLogsTitle: "Application logs",
	// Absolute POSIX or Windows path to electron-log's main log file.
	logFilePathPattern: /^(?:\/|[A-Za-z]:\\).*main\.log$/,
	kiloConfigTitle: "Kilo config",
	kiloConfigMissingDescription: "No global config file has been created yet.",
	kiloConfigFileName: "kilo.jsonc",
	kiloConfigFileContents: "{}\n",
	kiloConfigRevealMessage:
		"Show in file manager should reveal the Kilo config path shown in the row",
	logFileRevealMessage: "Show in file manager should reveal an absolute main.log path",
	revealInFileManagerLabel: revealInFileManagerLabel(process.platform),
	legalTitle: "Legal",
	viewTermsLabel: "View",
	thirdPartyNoticesTitle: "Third-party notices",
	// Written at package time; every build ships Electron, so its entry is always there.
	thirdPartyNoticesTextPattern: /^THIRD-PARTY SOFTWARE NOTICES[\s\S]*\nElectron \d+\.\d+\.\d+\n/,
	chromiumNoticesPathPattern: /LICENSES\.chromium\.html$/,
	chromiumNoticesRevealMessage:
		"Show in file manager should reveal Chromium's notices beside the app",
} as const;

function revealInFileManagerLabel(platform: NodeJS.Platform): string {
	if (platform === "darwin") return "Show in Finder";
	if (platform === "win32") return "Show in File Explorer";
	return "Show in File Manager";
}
