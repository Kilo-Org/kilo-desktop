/**
 * Resolves the anaconda-bridge-sidecar launch command.
 *
 * The payload ships a `manifest.json` containing the `launch` array — the
 * argv that starts the bridge process. This module reads that manifest and
 * returns the absolute launch command.
 *
 * In packaged mode:
 *   <app>/Contents/Resources/bridge/manifest.json → launch
 *
 * In dev mode:
 *   1. `BRIDGE_PAYLOAD` env var (path to a payload directory)
 *   2. `plugins/environments/resources/bridge/manifest.json`
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

interface PayloadManifest {
	readonly launch: readonly string[];
	readonly bridge_version: string;
}

export interface ResolveBridgeOptions {
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	/** Set to true when running inside the packaged Electron app. */
	readonly isPackaged?: boolean;
	/** Override for `process.resourcesPath` (for testing). */
	readonly resourcesPath?: string;
	/** Override for plugin root (for testing / dev). */
	readonly pluginRoot?: string;
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

export function resolveBridgeLaunchInfo(
	options: ResolveBridgeOptions = {},
): BridgeLaunchInfo | null {
	// 1. Environment variable override (highest priority, for local dev)
	const envOverride = process.env["BRIDGE_PAYLOAD"]?.trim();
	if (envOverride) {
		return buildLaunchInfo(envOverride);
	}

	// 2. Packaged app: payload is in process.resourcesPath/bridge/
	const isPackaged =
		options.isPackaged ??
		(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath !== undefined;
	if (isPackaged) {
		const resourcesPath =
			options.resourcesPath ??
			(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
		if (resourcesPath) {
			const info = buildLaunchInfo(path.join(resourcesPath, "bridge"));
			if (info) return info;
		}
	}

	// 3. Dev mode: look in the plugin's staged resources directory.
	// After Vite bundles the main process, `import.meta.dirname` no longer
	// reflects the original source tree — the define injected by
	// vite.main.config.ts gives us the correct absolute path instead.
	const pluginRoot =
		options.pluginRoot ??
		(typeof __ENVIRONMENTS_PLUGIN_ROOT__ !== "undefined"
			? __ENVIRONMENTS_PLUGIN_ROOT__
			: path.resolve(import.meta.dirname, "../../../.."));
	return buildLaunchInfo(path.join(pluginRoot, "resources", "bridge"));
}

// Re-export for backward compat — but the new primary API is resolveBridgeLaunchInfo
export function resolveBridgeBinaryPath(options: ResolveBridgeOptions = {}): string | null {
	const info = resolveBridgeLaunchInfo(options);
	return info ? (info.command[0] ?? null) : null;
}
