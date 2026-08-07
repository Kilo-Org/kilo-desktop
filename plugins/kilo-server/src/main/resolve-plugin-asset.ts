import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_CLI_SUBPATH = "resources/kilo";
const require = createRequire(import.meta.url);

/**
 * Resolve an asset subpath relative to the plugin package root.
 *
 * Uses `require.resolve` to locate the package via Node module resolution (works
 * from both the Vite bundle output and unbundled source), then `realpathSync` to
 * follow any workspace symlinks — ensuring we reach the workspace source tree
 * where `pnpm fetch-cli` stages the CLI binary, even when the `node_modules/`
 * entry is a pnpm workspace symlink (see #89).
 */
function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-kilo-server/plugin.json");
	const packageDir = realpathSync(path.dirname(manifestPath));
	return path.resolve(packageDir, subpath);
}

export function createKiloServerResolveAsset(options: {
	readonly isPackaged: boolean;
	readonly packagedResourcesPath: string;
}): (subpath: string) => string {
	return (subpath) => {
		if (options.isPackaged && subpath === PACKAGED_CLI_SUBPATH) {
			return path.join(options.packagedResourcesPath, "kilo");
		}
		return resolvePackageAsset(subpath);
	};
}
