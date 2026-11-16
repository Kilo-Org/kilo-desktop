import type { UpdaterState as DesktopUpdateState } from "@kilo-desktop/kernel";

export interface InstallConfirmation {
	title: string;
	description: string;
	/** Extra guidance for Windows, where the installer runs silently. */
	windowsNote: string | null;
}

export function getInstallConfirmation(
	state: Pick<DesktopUpdateState, "downloadedVersion" | "availableVersion">,
	platform = "",
): InstallConfirmation {
	const version = state.downloadedVersion ?? state.availableVersion;
	return {
		title: `Install update${version ? ` ${version}` : ""} and restart Kilo Desktop?`,
		description:
			"Any running sessions will be interrupted. Make sure you're ready before continuing.",
		windowsNote: /Win/i.test(platform)
			? "On Windows, the app may remain closed for several minutes while the update installs, and no installer window may appear. It will reopen automatically when installation finishes."
			: null,
	};
}

/** Plain-text form of {@link getInstallConfirmation}, for the native confirm prompt. */
export function getInstallConfirmationMessage(
	state: Pick<DesktopUpdateState, "downloadedVersion" | "availableVersion">,
	platform = "",
): string {
	const { title, description, windowsNote } = getInstallConfirmation(state, platform);
	return [title, description, windowsNote].filter(Boolean).join("\n\n");
}

export function updateAvailableLabel(state: Pick<DesktopUpdateState, "availableVersion">): string {
	return state.availableVersion
		? `Version ${state.availableVersion} is available to download`
		: "An update is available to download";
}

export function updateReadyLabel(state: DesktopUpdateState): string {
	return state.downloadedVersion
		? `Update ${state.downloadedVersion} ready to install`
		: "Update ready to install";
}
