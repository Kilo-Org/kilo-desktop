import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const nonRuntimePackageDirectories = [".turbo", ".vitest", "coverage", "e2e"] as const;

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

	// The environments plugin has already staged this payload as Resources/bridge.
	await rm(path.join(nodeModules, "@anaconda", "desktop-bridge-payload-darwin-arm64"), {
		force: true,
		recursive: true,
	});
}
