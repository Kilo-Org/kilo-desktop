import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_CLI_SUBPATH = "resources/kilo";
const require = createRequire(import.meta.url);

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
		return resolvePackageAsset(subpath);
	};
}
