/**
 * User-facing messages for environments failures.
 *
 * FeatureErrors cross the IPC boundary as `"CODE: detail"` strings
 * (see contracts/common.ts). Surfacing that raw form to users leaks internal
 * fragments like
 * `PROVIDER_NOT_READY: anaconda-bridge-sidecar error: Unexpected error in
 * conda.create: KeyError`. This helper recovers the granular
 * {@link EnvironmentsErrorCode} and returns a short, actionable sentence
 * instead, falling back to a generic message when the error does not follow
 * the plugin's convention.
 */

import {
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
} from "../../../contracts/common";

/** Friendly, action-oriented copy per granular error code. */
const FRIENDLY_MESSAGE: Record<EnvironmentsErrorCode, string> = {
	ENV_EXISTS:
		"An environment already exists at that location. Choose a different name or location.",
	ENV_NOT_FOUND: "That environment could not be found. It may have been moved or removed.",
	PACKAGE_NOT_FOUND:
		"One or more selected packages could not be found in the chosen channels. Check the names or add a channel that provides them.",
	CHANNEL_NOT_FOUND:
		"A selected channel could not be reached. Check the channel name and your connection.",
	NO_CHANNELS_CONFIGURED:
		"No conda channels are configured, so there is nothing to install from. Add a channel, or install from Anaconda's `defaults` channel.",
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
 * Opaque bridge detail fragments that carry no user-actionable information.
 * These are transient JSON-RPC plumbing states that surface while the
 * sidecar is starting or restarting (e.g. an in-flight request rejected
 * because the connection was torn down mid-restart, or a spawn that has not
 * finished its health check yet). Surfacing them only alarms the user with
 * internal jargon, so we suppress them and show the plain "not ready" copy.
 */
const OPAQUE_BRIDGE_DETAIL_PREFIXES = ["bridge failed to start"] as const;
const OPAQUE_BRIDGE_DETAIL_SUBSTRINGS = ["connection got disposed"] as const;

function isOpaqueBridgeDetail(detail: string): boolean {
	const lower = detail.toLowerCase();
	return (
		OPAQUE_BRIDGE_DETAIL_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
		OPAQUE_BRIDGE_DETAIL_SUBSTRINGS.some((substring) => lower.includes(substring))
	);
}

function isAbsolutePath(value: string): boolean {
	return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

/**
 * The create was rejected because the prefix is taken — most often by a
 * duplicate or concurrent create that already succeeded, so say so rather
 * than implying the user did something wrong.
 */
function existingPrefixMessage(prefix: string): string {
	return `An environment already exists at ${prefix}. It may have been created by an earlier or concurrent request — check the environments list, or choose a different name or location.`;
}

/**
 * Convert a caught error (or any value) into a friendly, user-facing message.
 * Recognised environments error codes map to curated copy; anything else
 * falls back to `fallback`.
 *
 * For `PROVIDER_NOT_READY` errors that contain a bridge detail string, the
 * detail is appended so the user sees something actionable (e.g. a YAML
 * parse error in `.condarc`) rather than just "backend not ready". Opaque
 * plumbing details (see {@link isOpaqueBridgeDetail}) are suppressed.
 */
export function friendlyEnvironmentsError(reason: unknown, fallback: string): string {
	const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
	const parsed = raw ? parseEnvironmentsErrorMessage(raw) : null;
	if (!parsed) return fallback;

	if (parsed.code === "ENV_EXISTS" && parsed.detail && isAbsolutePath(parsed.detail)) {
		return existingPrefixMessage(parsed.detail);
	}

	const friendly = FRIENDLY_MESSAGE[parsed.code];
	// For opaque "not ready" errors, surface the bridge detail when it
	// carries real information (avoids hiding fixable config issues).
	if (parsed.code === "PROVIDER_NOT_READY" && parsed.detail) {
		const detail = parsed.detail.replace(/^anaconda-bridge-sidecar error:\s*/i, "").trim();
		if (detail && !isOpaqueBridgeDetail(detail)) {
			return `${friendly} (${detail})`;
		}
	}
	return friendly;
}

/**
 * Whether a caught error is a `PROVIDER_NOT_READY` failure — the conda
 * backend (anaconda-bridge-sidecar) is still starting up or is restarting.
 *
 * Distinct from a genuine failure: the backend recovers on its own via the
 * sidecar's restart-on-exit machinery, so the UI treats these as a
 * transient "starting up" state (polled until it clears) rather than a hard
 * error.
 */
export function isProviderNotReadyError(reason: unknown): boolean {
	const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
	if (!raw) return false;
	return parseEnvironmentsErrorMessage(raw)?.code === "PROVIDER_NOT_READY";
}
