import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_CLI_SUBPATH = "resources/kilo";
const require = createRequire(import.meta.url);

/**
 * Resolve from the workspace source tree relative to this file.
 *
 * `pnpm fetch-cli` stages the CLI binary into
 * `plugins/kilo-server/resources/kilo/` which is gitignored and only populated
 * after the fetch script runs. In dev mode, `require.resolve` points into the
 * injected copy in `node_modules/` which is stale (created at `pnpm install`
 * time before the CLI is fetched). This helper resolves directly from the
 * workspace source so the freshly fetched binary is found without needing to
 * re-run `pnpm install`.
 */
function resolveWorkspaceCliAsset(): string {
	return path.resolve(import.meta.dirname, "../../resources/kilo");
}

function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-kilo-server/plugin.json");
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
		// Dev: resolve CLI resources from workspace source to avoid stale
		// injected-dep copies in node_modules/ (see #89).
		if (!options.isPackaged && subpath === PACKAGED_CLI_SUBPATH) {
			return resolveWorkspaceCliAsset();
		}
		return resolvePackageAsset(subpath);
	};
}
