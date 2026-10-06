import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_CLI_SUBPATH = "resources/kilo";
const require = createRequire(import.meta.url);

/**
 * Resolve an asset subpath relative to the plugin package root.
 *
 * `apps/desktop` and `apps/web` depend on this plugin via the pnpm
 * `workspace:*` protocol (see #89), so `require.resolve` follows a real symlink
 * into the workspace source tree — the same directory where `pnpm fetch-cli`
 * stages the gitignored CLI binary.
 */
function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@kilo-desktop/plugin-kilo-server/plugin.json");
	return path.resolve(path.dirname(manifestPath), subpath);
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
