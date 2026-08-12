import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_NOTEBOOK_SUBPATH = "build/notebook";
const require = createRequire(import.meta.url);

function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-notebook/plugin.json");
	return path.resolve(path.dirname(manifestPath), subpath);
}

export function createNotebookResolveAsset(options: {
	readonly isPackaged: boolean;
	readonly packagedResourcesPath: string;
}): (subpath: string) => string {
	return (subpath) => {
		if (options.isPackaged && subpath === PACKAGED_NOTEBOOK_SUBPATH) {
			return path.join(options.packagedResourcesPath, "notebook");
		}
		return resolvePackageAsset(subpath);
	};
}
