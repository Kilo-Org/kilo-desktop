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
 * the plugin's convention. The parsed detail and {@link PolicyNotice} come
 * along, so surfaces can show the raw solver output and the policy details
 * (`PolicyErrorDetails`).
 */

import {
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
	type ParsedEnvironmentsError,
	type PolicyBlockedPackage,
	type PolicyNotice,
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
	POLICY_BLOCKED:
		"One or more selected packages are blocked by your organization's package policy. Choose a different version or package, or ask your organization's administrator.",
	NOT_SIGNED_IN: "This channel needs an Anaconda account. Sign in to Anaconda, then try again.",
	CHANNEL_ACCESS_DENIED:
		"Anaconda refused access to this channel. Your sign-in may have expired, or your account may not have access to it. Sign in to Anaconda again, or ask your organization's administrator.",
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

/** A caught failure as the UI shows it. */
export interface FriendlyEnvironmentsError {
	/** The granular code; null when the error does not follow the plugin's convention. */
	code: EnvironmentsErrorCode | null;
	/** Friendly, user-facing sentence(s). */
	message: string;
	/** Raw bridge or solver text for an expandable details block, when there is any. */
	detail?: string;
	/** Blocked packages, policy note and refused channel (`PolicyErrorDetails` shows them). */
	policy?: PolicyNotice;
}

/**
 * Convert a caught error (or any value) into what the UI shows. Recognised
 * environments error codes map to curated copy; anything else falls back to
 * `fallback`.
 *
 * For `PROVIDER_NOT_READY` errors that contain a bridge detail string, the
 * detail is appended so the user sees something actionable (e.g. a YAML
 * parse error in `.condarc`) rather than just "backend not ready". Opaque
 * plumbing details (see {@link isOpaqueBridgeDetail}) are suppressed.
 *
 * `POLICY_BLOCKED` is the exception to curated copy: the bridge's summary
 * (the lines before the first blank line: package, policy and the platform's
 * reason, verbatim) is the message, and only the solver text after it stays
 * as detail. Anaconda sign-in refusals name the refused channel when known.
 */
export function friendlyEnvironmentsError(
	reason: unknown,
	fallback: string,
	options: FriendlyErrorOptions = {},
): FriendlyEnvironmentsError {
	const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
	const parsed = raw ? parseEnvironmentsErrorMessage(raw) : null;
	if (!parsed) return { code: null, message: fallback };
	const policy = parsed.policy ? { policy: parsed.policy } : {};

	const forOperation = operationMessage(options.operation, parsed.code, fallback);
	if (forOperation) {
		return {
			code: parsed.code,
			message: forOperation,
			...(parsed.detail ? { detail: parsed.detail } : {}),
			...policy,
		};
	}

	if (parsed.code === "POLICY_BLOCKED") {
		const { summary, rest } = splitPolicyBlockedDetail(parsed.detail);
		return {
			code: parsed.code,
			message: summary ?? FRIENDLY_MESSAGE.POLICY_BLOCKED,
			...(rest ? { detail: rest } : {}),
			...policy,
		};
	}
	return {
		code: parsed.code,
		message: friendlyMessage(parsed),
		...(parsed.detail ? { detail: parsed.detail } : {}),
		...policy,
	};
}

/**
 * What failed, where a code's usual copy would mislead:
 * - `remove`: removing packages re-solves the environment against its
 *   channels, so a policy channel refuses it while signed out of Anaconda;
 * - `clone`: the bridge never says why a clone failed (policy and sign-in
 *   failures included arrive as a generic `failed-to-clone`), so it is not
 *   called a dependency conflict.
 */
export type EnvironmentsOperation = "remove" | "clone";

export interface FriendlyErrorOptions {
	readonly operation?: EnvironmentsOperation | undefined;
}

const SIGN_IN_TO_CHANGE_MESSAGE =
	"Sign in to Anaconda to change this environment: removing packages re-solves it against its channels.";

function operationMessage(
	operation: EnvironmentsOperation | undefined,
	code: EnvironmentsErrorCode,
	fallback: string,
): string | undefined {
	if (operation === "remove" && code === "NOT_SIGNED_IN") return SIGN_IN_TO_CHANGE_MESSAGE;
	if (operation === "clone" && code === "SOLVE_FAILED") return fallback;
	return undefined;
}

function friendlyMessage({ code, detail, policy }: ParsedEnvironmentsError): string {
	if (code === "ENV_EXISTS" && detail && isAbsolutePath(detail)) {
		return existingPrefixMessage(detail);
	}
	const channel = policy?.refused?.channel;
	if (code === "NOT_SIGNED_IN" && channel) {
		return `${channel} needs an Anaconda account. Sign in to Anaconda, then try again.`;
	}
	if (code === "CHANNEL_ACCESS_DENIED" && channel) {
		return FRIENDLY_MESSAGE.CHANNEL_ACCESS_DENIED.replace("this channel", channel);
	}

	const friendly = FRIENDLY_MESSAGE[code];
	// For opaque "not ready" errors, surface the bridge detail when it
	// carries real information (avoids hiding fixable config issues).
	if (code === "PROVIDER_NOT_READY" && detail) {
		const bridgeDetail = detail.replace(/^anaconda-bridge-sidecar error:\s*/i, "").trim();
		if (bridgeDetail && !isOpaqueBridgeDetail(bridgeDetail)) {
			return `${friendly} (${bridgeDetail})`;
		}
	}
	return friendly;
}

/** The bridge's `blocked_by_policy` message: a line per blocked package, a blank line, then the solver text. */
function splitPolicyBlockedDetail(detail: string | undefined): { summary?: string; rest?: string } {
	if (!detail) return {};
	const [summary = "", ...rest] = detail.split(/\n\s*\n/);
	const solverText = rest.join("\n\n").trim();
	return {
		...(summary.trim() ? { summary: summary.trim() } : {}),
		...(solverText ? { rest: solverText } : {}),
	};
}

/** repo.anaconda.cloud refused the request: the Anaconda (not Kilo) account is missing or refused. */
export function needsAnacondaSignIn(code: EnvironmentsErrorCode | null): boolean {
	return code === "NOT_SIGNED_IN" || code === "CHANNEL_ACCESS_DENIED";
}

/**
 * The title of an error card (the Add packages and Update previews). A solve
 * failure is a "Dependency conflict"; other failures are not called one.
 */
export function errorCardTitle(error: Pick<FriendlyEnvironmentsError, "code" | "policy">): string {
	switch (error.code) {
		case "POLICY_BLOCKED":
			return "Blocked by your organization's policy";
		case "NOT_SIGNED_IN":
		case "CHANNEL_ACCESS_DENIED":
			return "Sign in to Anaconda";
		case "SOLVE_FAILED":
			return error.policy?.policyNote
				? "Dependency conflict under your organization's policy"
				: "Dependency conflict";
		case "PACKAGE_NOT_FOUND":
			return "Package not found";
		case "CHANNEL_NOT_FOUND":
			return "Channel not found";
		case "NO_CHANNELS_CONFIGURED":
			return "No channels configured";
		default:
			return "Couldn't complete the change";
	}
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

export interface KeyedBlockedPackage {
	/** Stable across reorders: built from the entry's content, not its position. */
	readonly key: string;
	readonly entry: PolicyBlockedPackage;
}

/**
 * The blocked packages as list rows: each keyed by its content, with exact
 * duplicates dropped, since they would only repeat a row.
 */
export function keyedBlockedPackages(
	blocked: readonly PolicyBlockedPackage[],
): KeyedBlockedPackage[] {
	const rows = new Map<string, PolicyBlockedPackage>();
	for (const entry of blocked) {
		const key = JSON.stringify([
			entry.package,
			entry.version,
			entry.channel,
			entry.org,
			entry.policy,
			entry.policyId,
			entry.reason,
		]);
		if (!rows.has(key)) rows.set(key, entry);
	}
	return [...rows].map(([key, entry]) => ({ key, entry }));
}
