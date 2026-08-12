import { createRequire } from "node:module";
import path from "node:path";

const PACKAGED_NOTEBOOK_SUBPATH = "build/notebook";
const PACKAGED_NATIVE_ROOTS = ["resources/runtimed", "resources/runt"] as const;
const require = createRequire(import.meta.url);

function resolvePackageAsset(subpath: string): string {
	const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-notebook/plugin.json");
	return path.resolve(path.dirname(manifestPath), subpath);
}

function packagedNativeRoot(subpath: string): (typeof PACKAGED_NATIVE_ROOTS)[number] | undefined {
	return PACKAGED_NATIVE_ROOTS.find(
		(root) => subpath === root || subpath.startsWith(`${root}/`) || subpath.startsWith(`${root}\\`),
	);
}

export function createNotebookResolveAsset(options: {
	readonly isPackaged: boolean;
	readonly packagedResourcesPath: string;
}): (subpath: string) => string {
	return (subpath) => {
		if (options.isPackaged && subpath === PACKAGED_NOTEBOOK_SUBPATH) {
			return path.join(options.packagedResourcesPath, "notebook");
		}
		const nativeRoot = options.isPackaged ? packagedNativeRoot(subpath) : undefined;
		if (nativeRoot) {
			const folderName = nativeRoot.slice("resources/".length);
			return path.join(
				options.packagedResourcesPath,
				folderName,
				subpath.slice(nativeRoot.length).replace(/^[/\\]+/, ""),
			);
		}
		return resolvePackageAsset(subpath);
	};
}

export {
	findRuntArtifact,
	getRuntArtifact,
	getRuntimedArtifact,
	NTERACT_RELEASE,
	RUNT_ARTIFACTS,
	RUNTIMED_ARTIFACTS,
} from "./distribution/artifacts.js";
