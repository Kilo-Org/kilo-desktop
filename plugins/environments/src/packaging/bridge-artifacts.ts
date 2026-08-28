/**
 * Bridge payload resolution — finds the installed npm payload package for the
 * current platform and reads its manifest.
 *
 * The payload is delivered as a platform-specific npm package:
 *   @anaconda/desktop-bridge-payload-<os>-<cpu>
 *
 * Each package contains a `manifest.json` describing the launch contract,
 * Mach-O inventory, and version metadata.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface BridgePayloadManifest {
	readonly schema: number;
	readonly target: string;
	readonly python_version: string;
	readonly bridge_version: string;
	readonly launch: readonly string[];
	readonly packages: Record<string, string>;
	readonly macho: readonly string[];
}

export interface BridgePayloadInfo {
	/** Absolute path to the payload root directory. */
	readonly payloadRoot: string;
	/** Parsed manifest.json from the payload. */
	readonly manifest: BridgePayloadManifest;
	/** The npm package name that supplied this payload. */
	readonly packageName: string;
}

/**
 * Map from `${platform}-${arch}` to the npm package name that carries
 * the payload for that target. Only targets with published packages are listed.
 */
const PAYLOAD_PACKAGES: Record<string, string> = {
	"darwin-arm64": "@anaconda/desktop-bridge-payload-darwin-arm64",
};

export function getPayloadPackageName(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): string | null {
	return PAYLOAD_PACKAGES[`${platform}-${arch}`] ?? null;
}

/**
 * Resolve the installed payload package for the current (or given) platform.
 * Returns null if the package is not installed or the manifest is missing.
 */
export function resolveInstalledPayload(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): BridgePayloadInfo | null {
	const packageName = getPayloadPackageName(platform, arch);
	if (!packageName) return null;

	// Resolve the package first: a resolution failure means "payload not
	// installed for this platform" and is the only case we swallow. Reading /
	// parsing the manifest is done OUTSIDE this guard so a corrupt or
	// unreadable manifest on a supported platform fails loudly instead of
	// masquerading as "not installed".
	const require = createRequire(path.resolve(import.meta.dirname, "../../package.json"));
	let manifestPath: string;
	try {
		manifestPath = require.resolve(`${packageName}/manifest.json`);
	} catch (error) {
		if (isModuleNotFound(error)) return null;
		throw error;
	}

	const payloadRoot = path.dirname(manifestPath);
	const manifest: BridgePayloadManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	return { payloadRoot, manifest, packageName };
}

/** Node throws these codes when a require target cannot be resolved. */
function isModuleNotFound(error: unknown): boolean {
	const code = (error as { code?: string } | null)?.code;
	return (
		code === "MODULE_NOT_FOUND" ||
		code === "ERR_MODULE_NOT_FOUND" ||
		code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
	);
}

/**
 * Read a staged payload manifest from a given directory.
 */
export function readStagedManifest(bridgeDir: string): BridgePayloadManifest | null {
	const manifestPath = path.join(bridgeDir, "manifest.json");
	if (!existsSync(manifestPath)) return null;
	try {
		return JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
}
