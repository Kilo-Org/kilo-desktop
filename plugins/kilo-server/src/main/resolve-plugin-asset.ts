import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_CLI_SUBPATH = "resources/kilo";
const require = createRequire(import.meta.url);

/**
 * Resolve an asset subpath relative to the plugin package root using Node
 * module resolution. Used as a fallback for non-CLI assets.
 */
function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-kilo-server/plugin.json");
	return path.resolve(path.dirname(manifestPath), subpath);
}

/**
 * Build a resolver that maps plugin-relative asset subpaths to absolute paths.
 *
 * CLI resolution (`resources/kilo`) uses one of three layouts:
 *   - Packaged: `<packagedResourcesPath>/kilo` (staged by electron-forge).
 *   - Dev (bundled Electron main via Vite): the host injects
 *     `devResourceRoot`, an absolute path to the workspace source
 *     `plugins/kilo-server/resources/kilo/`. Required because pnpm's
 *     `injectWorkspacePackages` hardlinks node_modules copies at install
 *     time, before `pnpm fetch-cli` stages the gitignored CLI binary — so
 *     `require.resolve` finds a stale injected copy without the CLI (#89).
 *   - Fallback (tests, no dev override): `resolvePackageAsset`, which works
 *     when the plugin package is symlinked into node_modules.
 *
 * Other asset subpaths always go through `resolvePackageAsset`.
 */
export function createKiloServerResolveAsset(options: {
	readonly isPackaged: boolean;
	readonly packagedResourcesPath: string;
	readonly devResourceRoot?: string;
}): (subpath: string) => string {
	return (subpath) => {
		if (subpath === PACKAGED_CLI_SUBPATH) {
			if (options.isPackaged) {
				return path.join(options.packagedResourcesPath, "kilo");
			}
			if (options.devResourceRoot) {
				return options.devResourceRoot;
			}
		}
		return resolvePackageAsset(subpath);
	};
}
