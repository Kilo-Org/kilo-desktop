import type { DesktopUpdateState } from "@kilo-desktop/contracts";

export function getInstallConfirmationMessage(
	state: Pick<DesktopUpdateState, "downloadedVersion" | "availableVersion">,
	platform = "",
): string {
	const version = state.downloadedVersion ?? state.availableVersion;
	const windowsWarning = /Win/i.test(platform)
		? "\n\nOn Windows, the app may remain closed for several minutes while the update installs, and no installer window may appear. It will reopen automatically when installation finishes."
		: "";
	return `Install update${version ? ` ${version}` : ""} and restart Kilo Desktop?\n\nAny running sessions will be interrupted. Make sure you're ready before continuing.${windowsWarning}`;
}

export function updateReadyLabel(state: DesktopUpdateState): string {
	return state.downloadedVersion
		? `Update ${state.downloadedVersion} ready to install`
		: "Update ready to install";
}
