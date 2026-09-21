import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const nonRuntimePackageDirectories = [".turbo", ".vitest", "coverage", "e2e"] as const;
const stagedKiloCliPackages = [
	"cli-darwin-arm64",
	"cli-linux-x64-baseline",
	"cli-windows-x64-baseline",
] as const;

export async function pruneProductionDependencies(nodeModules: string): Promise<void> {
	const workspacePackages = path.join(nodeModules, "@kilo-desktop");
	let packageNames: string[] = [];
	try {
		packageNames = await readdir(workspacePackages);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await Promise.all(
		packageNames.flatMap((packageName) =>
			nonRuntimePackageDirectories.map((directory) =>
				rm(path.join(workspacePackages, packageName, directory), { force: true, recursive: true }),
			),
		),
	);

	// Bridge payloads are already staged as Resources/bridge by the environments
	// plugin, so any copy pnpm deploy left in node_modules is pure duplication
	// (each payload is a full relocatable Python runtime, hundreds of MB).
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
