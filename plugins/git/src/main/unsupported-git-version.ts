import { KernelError } from "@kilo-desktop/kernel";
import type { UnsupportedGitVersionError } from "@kilo-desktop/git-client";

/** "2.17.0" → "2.17": git releases are referred to by major.minor. */
function displayVersion(version: string): string {
	return version.replace(/\.0$/, "");
}

/**
 * User-facing copy for a git older than the client's minimum. Asks for a
 * restart because git-client checks the version once per client and keeps
 * the "too old" verdict for the app's lifetime.
 */
export function unsupportedGitVersionToKernelError(error: UnsupportedGitVersionError): KernelError {
	return new KernelError(
		"BUSINESS",
		`Kilo Desktop needs Git ${displayVersion(error.minimumVersion)} or newer, but found Git ${displayVersion(error.version)}. Update Git, then restart Kilo Desktop.`,
	);
}
