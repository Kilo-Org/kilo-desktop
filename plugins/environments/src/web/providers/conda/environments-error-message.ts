/**
 * User-facing messages for environments failures.
 *
 * FeatureErrors cross the IPC boundary as `"CODE: detail"` strings
 * (see contracts/common.ts). Surfacing that raw form to users leaks Python
 * traceback fragments like
 * `PROVIDER_NOT_READY: conda.exceptions.CondaValueError: prefix already
 * exists: /Users/…`. This helper recovers the granular
 * {@link EnvironmentsErrorCode} and returns a short, actionable sentence
 * instead, falling back to a generic message when the error does not follow
 * the plugin's convention.
 */

import {
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
} from "../../../contracts/common.js";

/** Friendly, action-oriented copy per granular error code. */
const FRIENDLY_MESSAGE: Record<EnvironmentsErrorCode, string> = {
	ENV_EXISTS:
		"An environment already exists at that location. Choose a different name or location.",
	ENV_NOT_FOUND: "That environment could not be found. It may have been moved or removed.",
	PACKAGE_NOT_FOUND:
		"One or more selected packages could not be found in the chosen channels. Check the names or add a channel that provides them.",
	CHANNEL_NOT_FOUND:
		"A selected channel could not be reached. Check the channel name and your connection.",
	SOLVE_FAILED:
		"Could not resolve a compatible set of packages. Try removing a package or relaxing a version.",
	INVALID_MATCHSPEC:
		"One of the package specifications is not valid. Check the package names and versions.",
	INVALID_CHANNEL: "One of the channels is not valid. Check the channel name.",
	PREFIX_NOT_STAGED: "The environment could not be prepared. Please try again.",
	STAGING_FAILED: "Preparing the environment failed. Please try again.",
	INSTALLER_DOWNLOAD_FAILED:
		"Downloading the installer failed. Check your connection and try again.",
	INSTALLER_SHA_MISMATCH: "The downloaded installer failed verification. Please try again.",
	JOB_NOT_FOUND: "That operation is no longer running.",
	JOB_CANCELLED: "The operation was cancelled.",
	PROVIDER_NOT_READY: "The conda backend is not ready. Please try again in a moment.",
};

/**
 * Convert a caught error (or any value) into a friendly, user-facing message.
 * Recognised environments error codes map to curated copy; anything else
 * falls back to `fallback`.
 *
 * For `PROVIDER_NOT_READY` errors that contain a bridge detail string, the
 * detail is appended so the user sees something actionable (e.g. a YAML
 * parse error in `.condarc`) rather than just "backend not ready".
 */
export function friendlyEnvironmentsError(reason: unknown, fallback: string): string {
	const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
	const parsed = raw ? parseEnvironmentsErrorMessage(raw) : null;
	if (!parsed) return fallback;

	const friendly = FRIENDLY_MESSAGE[parsed.code];
	// For opaque "not ready" errors, surface the bridge detail when it
	// carries real information (avoids hiding fixable config issues).
	if (parsed.code === "PROVIDER_NOT_READY" && parsed.detail) {
		const detail = parsed.detail.replace(/^anaconda-bridge-sidecar error:\s*/i, "").trim();
		if (detail && !detail.startsWith("bridge failed to start")) {
			return `${friendly} (${detail})`;
		}
	}
	return friendly;
}
