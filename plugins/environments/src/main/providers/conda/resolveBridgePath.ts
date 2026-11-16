/**
 * Resolves the anaconda-bridge-sidecar launch command.
 *
 * The payload ships a `manifest.json` containing the `launch` array — the
 * argv that starts the bridge process. This module reads that manifest and
 * returns the absolute launch command.
 *
 * Searched in order:
 *   1. `BRIDGE_PAYLOAD` env var (path to a payload directory, for local dev)
 *   2. the plugin's `resources/bridge` asset folder: the app's
 *      `Resources/bridge` when packaged, `plugins/environments/resources/bridge`
 *      in development
 *
 * Returns `null` if the payload cannot be found (caller should fall back or throw).
 */

import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";

export interface BridgeLaunchInfo {
	/** Absolute argv to spawn the bridge process. */
	readonly command: readonly string[];
	/** Absolute path to the payload root directory. */
	readonly payloadRoot: string;
	/** Bridge version from the manifest. */
	readonly version: string;
}

export interface BridgeResolutionSuccess {
	readonly kind: "found";
	readonly info: BridgeLaunchInfo;
}

export interface BridgeResolutionFailure {
	readonly kind: "not-found";
	/** Absolute paths that were searched (in priority order). */
	readonly searchedPaths: readonly string[];
}

export type BridgeResolutionResult = BridgeResolutionSuccess | BridgeResolutionFailure;

interface PayloadManifest {
	readonly launch: readonly string[];
	readonly bridge_version: string;
}

export interface ResolveBridgeOptions {
	/** The plugin's `resources/bridge` folder; absent where the host ships no assets. */
	readonly bridgeDir?: string | undefined;
	/** Defaults to `process.env`. */
	readonly env?: Readonly<Record<string, string | undefined>>;
}

function readManifest(bridgeDir: string): PayloadManifest | null {
	const manifestPath = path.join(bridgeDir, "manifest.json");
	let parsed: unknown;
	try {
		accessSync(manifestPath);
		parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
	// Validate the shape before returning so a parseable-but-malformed
	// manifest (missing/non-array `launch`, missing `bridge_version`) resolves
	// to `null` — honouring this module's "payload not found → fall back"
	// contract — instead of throwing an uncaught TypeError up through
	// CondaProvider.boot() and crashing the plugin's boot sequence.
	if (!isPayloadManifest(parsed)) return null;
	return parsed;
}

function isPayloadManifest(value: unknown): value is PayloadManifest {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		Array.isArray(record["launch"]) &&
		record["launch"].every((segment) => typeof segment === "string") &&
		typeof record["bridge_version"] === "string"
	);
}

function buildLaunchInfo(bridgeDir: string): BridgeLaunchInfo | null {
	const manifest = readManifest(bridgeDir);
	if (!manifest || manifest.launch.length === 0) return null;

	const command = manifest.launch.map((segment, index) =>
		// The first element is the relative path to the interpreter binary;
		// make it absolute. The rest are flags/args that stay as-is.
		index === 0 ? path.join(bridgeDir, segment) : segment,
	);

	// Verify the binary exists AND is executable — X_OK, not just F_OK — so a
	// staging/chmod bug surfaces here as a clean fall-back rather than later
	// as a confusing EACCES from spawn().
	try {
		accessSync(command[0]!, constants.X_OK);
	} catch {
		return null;
	}

	return { command, payloadRoot: bridgeDir, version: manifest.bridge_version };
}

/**
 * Primary resolution API. Returns a discriminated result so callers can
 * log which paths were tried when the payload is absent.
 */
export function resolveBridge(options: ResolveBridgeOptions = {}): BridgeResolutionResult {
	const searchedPaths: string[] = [];
	const envOverride = (options.env ?? process.env)["BRIDGE_PAYLOAD"]?.trim();
	if (envOverride) {
		searchedPaths.push(envOverride);
		const info = buildLaunchInfo(envOverride);
		return info ? { kind: "found", info } : { kind: "not-found", searchedPaths };
	}
	if (options.bridgeDir) {
		searchedPaths.push(options.bridgeDir);
		const info = buildLaunchInfo(options.bridgeDir);
		if (info) return { kind: "found", info };
	}
	return { kind: "not-found", searchedPaths };
}

/** {@link resolveBridge} without the searched-paths diagnostic. */
export function resolveBridgeLaunchInfo(
	options: ResolveBridgeOptions = {},
): BridgeLaunchInfo | null {
	const result = resolveBridge(options);
	return result.kind === "found" ? result.info : null;
}
