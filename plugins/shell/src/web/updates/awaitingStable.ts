import type { UpdaterState } from "@kilo-desktop/kernel";

/** Where people get the current Stable release by hand ("All Downloads"). */
export const STABLE_DOWNLOADS_URL = "https://kilo.ai/install";

/**
 * The first Stable version a Preview installation can move to after switching
 * to the Stable track, or null when it isn't waiting for one. The updater never
 * downgrades, and a Preview build (`1.2.3-preview-…`) sorts just below Stable
 * `1.2.3`, so that is the earliest Stable release that replaces it.
 */
export function awaitedStableVersion(state: UpdaterState): string | null {
	if (!state.enabled || state.track !== "stable" || state.installedTrack !== "preview") {
		return null;
	}
	// Native "update-available" can leave availableVersion null when release notes fail.
	if (
		state.status === "downloading" ||
		state.status === "downloaded" ||
		state.status === "available" ||
		state.availableVersion ||
		state.downloadedVersion
	) {
		return null;
	}
	return state.currentVersion.split("-")[0] || null;
}
