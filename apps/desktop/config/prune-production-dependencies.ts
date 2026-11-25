import { readdir, rm } from "node:fs/promises";
import path from "node:path";

// Workspace packages are bundled into main.js (and the renderer), so the copy
// in node_modules only needs what is resolved from disk at runtime: the
// manifest and `plugin.json` anchor `bundledPluginAssetResolver`, `drizzle/`
// holds migrations, `build/` holds prebuilt plugin UIs, `node_modules/` holds
// nested third-party deps, plus license notices. Everything else — notably
// `src/`, tests, configs and internal docs — would only disclose source to
// anyone who extracts app.asar. An allowlist keeps new top-level folders from
// shipping by default, whether they arrive via `pnpm deploy` or the
// linked-plugin copy in forge.config.ts. Workspace packages are identified by
// the caller's workspace listing, not by scope: one may ship under a
// third-party name.
const workspacePackageRuntimeEntries = new Set([
	"build",
	"dist",
	"drizzle",
	"node_modules",
	"package.json",
	"plugin.json",
	"THIRD_PARTY_NOTICES.md",
]);
const licenseFilePattern = /^(LICENSE|LICENCE|NOTICE)(\..+)?$/i;
const pnpmStoreArtifacts = [".pnpm", ".modules.yaml"] as const;
const stagedKiloCliPackages = [
	"cli-darwin-arm64",
	"cli-linux-arm64",
	"cli-linux-x64-baseline",
	"cli-windows-arm64",
	"cli-windows-x64-baseline",
] as const;

export async function pruneProductionDependencies(
	nodeModules: string,
	workspacePackageNames: readonly string[],
): Promise<void> {
	await Promise.all(
		workspacePackageNames.map((packageName) =>
			pruneWorkspacePackage(path.join(nodeModules, packageName)),
		),
	);

	// pnpm 12 `deploy` under nodeLinker: hoisted also materializes a full
	// virtual store of real copies beside the hoisted tree. Nothing resolves
	// through it (the tree has no symlinks into it), so it only doubled
	// app.asar, including second copies of the bridge payload and kilo CLI.
	await Promise.all(
		pnpmStoreArtifacts.map((entry) =>
			rm(path.join(nodeModules, entry), { force: true, recursive: true }),
		),
	);

	// Bridge payloads are already staged as Resources/bridge by the environments
	// plugin, so a hoisted copy in node_modules is pure duplication (each
	// payload is a full relocatable Python runtime, hundreds of MB).
	//
	// Matched by prefix rather than by an explicit platform list: the payload is
	// an os/cpu-gated optionalDependency, so exactly one can be present on any
	// given host, and a new target added to PAYLOAD_PACKAGES must not silently
	// start shipping twice because this list was not updated alongside it.
	await removeBridgePayloads(nodeModules);
	await Promise.all(
		stagedKiloCliPackages.map((packageName) =>
			rm(path.join(nodeModules, "@kilocode", packageName), { force: true, recursive: true }),
		),
	);
}

async function pruneWorkspacePackage(packageDirectory: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(packageDirectory);
	} catch (error) {
		// Not every workspace package is a production dependency of desktop.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	await Promise.all(
		entries
			.filter(
				(entry) => !workspacePackageRuntimeEntries.has(entry) && !licenseFilePattern.test(entry),
			)
			.map((entry) => rm(path.join(packageDirectory, entry), { force: true, recursive: true })),
	);
}

const bridgePayloadPrefix = "desktop-bridge-payload-";

async function removeBridgePayloads(nodeModules: string): Promise<void> {
	const scopeDirectory = path.join(nodeModules, "@anaconda");
	let entries: string[] = [];
	try {
		entries = await readdir(scopeDirectory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return;
	}
	await Promise.all(
		entries
			.filter((entry) => entry.startsWith(bridgePayloadPrefix))
			.map((entry) => rm(path.join(scopeDirectory, entry), { force: true, recursive: true })),
	);
}
