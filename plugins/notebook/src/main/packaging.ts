import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { findRuntArtifact } from "./distribution/artifacts.js";

const require = createRequire(import.meta.url);

export const NOTEBOOK_ASAR_UNPACK_PACKAGES = ["@runtimed"] as const;
export const NOTEBOOK_MAIN_EXTERNALS = [/^@runtimed\/node(?:\/.*)?$/] as const;

export interface NotebookPackagingPlan {
	readonly extraResources: readonly string[];
	readonly asarUnpackPackages: readonly string[];
}

export interface NotebookPackagingOptions {
	readonly pluginRoot?: string;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	readonly exists?: (filePath: string) => boolean;
}

function resolvePluginRoot(): string {
	return path.dirname(require.resolve("@anaconda-agentic-desktop/plugin-notebook/plugin.json"));
}

/**
 * Describes and validates the notebook resources the Electron host must copy
 * outside ASAR. Artifact names and layout remain owned by this plugin; Forge
 * only consumes the resulting generic resource list.
 */
export function createNotebookPackagingPlan(
	options: NotebookPackagingOptions = {},
): NotebookPackagingPlan {
	const pluginRoot = options.pluginRoot ?? resolvePluginRoot();
	const exists = options.exists ?? existsSync;
	const stagedNotebookBundle = path.join(pluginRoot, "build/notebook");
	const stagedRunt = path.join(pluginRoot, "resources/runt");
	const runtArtifact = findRuntArtifact(options.platform, options.arch);
	const requiredAssets = [
		path.join(stagedNotebookBundle, "index.html"),
		path.join(stagedNotebookBundle, "agentic-notebook-build.json"),
	];

	if (runtArtifact) {
		requiredAssets.push(
			path.join(stagedRunt, runtArtifact.target, runtArtifact.executable),
			path.join(stagedRunt, runtArtifact.target, "staged.json"),
		);
	}

	for (const requiredAsset of requiredAssets) {
		if (!exists(requiredAsset)) {
			throw new Error(
				`Notebook build asset is missing: ${requiredAsset}. Run the notebook plugin's prepare-assets script.`,
			);
		}
	}

	return {
		extraResources: [stagedNotebookBundle, ...(runtArtifact ? [stagedRunt] : [])],
		asarUnpackPackages: NOTEBOOK_ASAR_UNPACK_PACKAGES,
	};
}
