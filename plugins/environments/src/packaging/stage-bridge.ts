/**
 * Stages the bridge payload for the current platform into resources/bridge/.
 *
 * The payload comes from an installed npm package
 * (@anaconda/desktop-bridge-payload-<os>-<cpu>) which contains a full
 * relocatable Python + conda runtime. Staging copies it into the plugin's
 * resources directory so Electron Forge can bundle it as extraResources.
 *
 * The staged output is:
 *   resources/bridge/manifest.json
 *   resources/bridge/python/...
 *   resources/bridge/...
 */

import { accessSync, constants, existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveInstalledPayload, type BridgePayloadManifest } from "./bridge-artifacts.js";

export interface StageBridgeOptions {
	/** Root directory for staged bridge resources (e.g., `plugins/environments/resources/bridge`). */
	readonly resourceRoot: string;
	/** Override: path to a local bridge payload directory (skips npm resolution). */
	readonly sourcePath?: string;
	/** Override platform detection. */
	readonly platform?: NodeJS.Platform;
	/** Override arch detection. */
	readonly arch?: NodeJS.Architecture;
}

export interface StageBridgeResult {
	readonly staged: boolean;
	readonly payloadRoot: string;
	readonly version: string;
}

interface StagedState {
	readonly bridge_version: string;
	readonly staged_at: string;
	readonly source: string;
}

function stateFilePath(resourceRoot: string): string {
	return path.join(resourceRoot, ".staged-state.json");
}

async function isAlreadyStaged(resourceRoot: string, version: string): Promise<boolean> {
	const statePath = stateFilePath(resourceRoot);
	if (!existsSync(statePath)) return false;
	try {
		const raw = await readFile(statePath, "utf8");
		const state: StagedState = JSON.parse(raw);
		if (state.bridge_version !== version) return false;
	} catch {
		return false;
	}
	// The version marker matches — but a partial clean could have removed the
	// actual payload while leaving the marker behind. Cross-check that the
	// launch contract and interpreter are still on disk so we never report
	// "already staged" over a broken directory.
	const manifestPath = path.join(resourceRoot, "manifest.json");
	if (!existsSync(manifestPath)) return false;
	try {
		const manifest: BridgePayloadManifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const launchEntry = manifest.launch?.[0];
		if (!launchEntry) return false;
		const launchPath = path.join(resourceRoot, launchEntry);
		if (!existsSync(launchPath)) return false;
		// Verify the binary is executable — pnpm can strip +x bits during
		// install, which would leave a "staged" payload that cannot launch.
		try {
			accessSync(launchPath, constants.X_OK);
		} catch {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Stage the bridge payload for the current platform.
 *
 * - If `sourcePath` is set (via `BRIDGE_PAYLOAD` env var), copies from there.
 * - Otherwise resolves the installed npm payload package.
 * - Idempotent: skips if the staged version matches.
 */
export async function stageBridge(options: StageBridgeOptions): Promise<StageBridgeResult> {
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;

	let payloadRoot: string;
	let version: string;
	let source: string;

	if (options.sourcePath) {
		// Local override
		payloadRoot = options.sourcePath;
		const manifestPath = path.join(payloadRoot, "manifest.json");
		if (!existsSync(manifestPath)) {
			throw new Error(`BRIDGE_PAYLOAD path does not contain a manifest.json: ${payloadRoot}`);
		}
		const manifest: BridgePayloadManifest = JSON.parse(await readFile(manifestPath, "utf8"));
		version = manifest.bridge_version;
		source = `local:${payloadRoot}`;
	} else {
		// Resolve from npm package
		const payload = resolveInstalledPayload(platform, arch);
		if (!payload) {
			// No payload package for this platform — skip gracefully.
			// Only darwin-arm64 is published for now; other platforms are not yet supported.
			console.log(`No bridge payload package available for ${platform}/${arch} — skipping.`);
			return { staged: false, payloadRoot: options.resourceRoot, version: "none" };
		}
		payloadRoot = payload.payloadRoot;
		version = payload.manifest.bridge_version;
		source = `npm:${payload.packageName}@${version}`;
	}

	// Idempotency check
	if (await isAlreadyStaged(options.resourceRoot, version)) {
		console.log(`Bridge payload v${version} already staged — skipping.`);
		return { staged: false, payloadRoot: options.resourceRoot, version };
	}

	console.log(`Staging bridge payload v${version} from ${source}`);

	// Clean and copy
	await rm(options.resourceRoot, { recursive: true, force: true });
	await mkdir(options.resourceRoot, { recursive: true });
	await cp(payloadRoot, options.resourceRoot, { recursive: true });

	// Restore executable permissions on binaries. pnpm's content-addressable
	// store and hardlinking can strip the +x bit from files in npm packages,
	// so we explicitly chmod the entries listed in the manifest's `macho` array
	// (which enumerates all native binaries and shared objects).
	const stagedManifestPath = path.join(options.resourceRoot, "manifest.json");
	const stagedManifest: BridgePayloadManifest = JSON.parse(
		await readFile(stagedManifestPath, "utf8"),
	);
	const executables = [
		...(stagedManifest.launch?.[0] ? [stagedManifest.launch[0]] : []),
		...(stagedManifest.macho ?? []),
	];
	const seen = new Set<string>();
	for (const relative of executables) {
		if (seen.has(relative)) continue;
		seen.add(relative);
		const abs = path.join(options.resourceRoot, relative);
		if (existsSync(abs)) {
			await chmod(abs, 0o755);
		}
	}

	// Write state file for idempotency
	const state: StagedState = {
		bridge_version: version,
		staged_at: new Date().toISOString(),
		source,
	};
	await writeFile(stateFilePath(options.resourceRoot), `${JSON.stringify(state, null, "\t")}\n`);

	console.log(`Bridge payload staged at: ${options.resourceRoot}`);
	return { staged: true, payloadRoot: options.resourceRoot, version };
}
