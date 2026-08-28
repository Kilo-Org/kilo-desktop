import { existsSync } from "node:fs";
import path from "node:path";

import { getPayloadPackageName, readStagedManifest } from "./bridge-artifacts.js";

export interface BridgePackagingPlan {
	readonly extraResources: readonly string[];
}

export interface BridgePackagingOptions {
	readonly pluginRoot?: string;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	readonly exists?: (filePath: string) => boolean;
}

/**
 * Validates that the bridge payload has been staged and returns the
 * `extraResources` path for Electron Forge to include in the app bundle.
 * Returns an empty plan if no bridge is staged (platform not yet supported).
 */
export function createBridgePackagingPlan(
	options: BridgePackagingOptions = {},
): BridgePackagingPlan {
	const pluginRoot = options.pluginRoot ?? path.resolve(import.meta.dirname, "../..");
	const exists = options.exists ?? existsSync;

	const stagedBridgeDir = path.join(pluginRoot, "resources/bridge");
	const manifestPath = path.join(stagedBridgeDir, "manifest.json");

	if (!exists(manifestPath)) {
		// Distinguish a genuinely unsupported platform from a supported one
		// whose payload failed to stage. If a payload package is published for
		// this platform, a missing manifest means prepare-assets was skipped or
		// the optional dependency failed to install — fail loudly rather than
		// silently shipping without the bridge.
		const packageName = getPayloadPackageName(options.platform, options.arch);
		if (packageName) {
			throw new Error(
				`Bridge payload package ${packageName} is published for this platform but nothing is staged at ${manifestPath}. Run prepare-assets (fetch-bridge) before packaging.`,
			);
		}
		// No payload package for this platform — genuinely unsupported.
		return { extraResources: [] };
	}

	const manifest = readStagedManifest(stagedBridgeDir);
	if (!manifest) {
		throw new Error(`Cannot read bridge manifest at ${manifestPath}`);
	}

	// Verify the launch entry point exists
	if (!Array.isArray(manifest.launch)) {
		throw new Error(`Bridge manifest has a malformed launch field at ${manifestPath}`);
	}
	const launchEntry = manifest.launch[0];
	if (!launchEntry) {
		throw new Error(`Bridge manifest has an empty launch array at ${manifestPath}`);
	}
	const launchBinary = path.join(stagedBridgeDir, launchEntry);
	if (!exists(launchBinary)) {
		throw new Error(
			`Bridge launch binary not found: ${launchBinary}. The payload may be corrupted.`,
		);
	}

	return {
		extraResources: [stagedBridgeDir],
	};
}
