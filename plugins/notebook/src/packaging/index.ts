import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Forge evaluates this exported module directly in a plain Node subprocess.
// Keep its target layout self-contained so config loading does not depend on
// TypeScript's source-extension resolution before Vite has started.
const NTERACT_MCP_EXECUTABLES = new Map([
	["darwin-arm64", { nteractMcp: "nteract-mcp", runt: "runt-nightly" }],
	["darwin-x64", { nteractMcp: "nteract-mcp", runt: "runt-nightly" }],
	["linux-x64", { nteractMcp: "nteract-mcp", runt: "runt-nightly" }],
	["win32-x64", { nteractMcp: "nteract-mcp.exe", runt: "runt-nightly.exe" }],
]);
const RUNTIMED_EXECUTABLES = new Map([
	["darwin-arm64", "runtimed-nightly"],
	["darwin-x64", "runtimed-nightly"],
	["linux-x64", "runtimed-nightly"],
	["win32-x64", "runtimed-nightly.exe"],
]);
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
	return path.dirname(require.resolve("@kilo-desktop/plugin-notebook/plugin.json"));
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
	const stagedNteractMcp = path.join(pluginRoot, "resources/nteract-mcp");
	const stagedRuntimed = path.join(pluginRoot, "resources/runtimed");
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const target = `${platform}-${arch}`;
	const nteractMcpExecutables = NTERACT_MCP_EXECUTABLES.get(target);
	if (!nteractMcpExecutables) {
		throw new Error(`nteract-mcp is not configured for ${platform}/${arch}`);
	}
	const runtimedExecutable = RUNTIMED_EXECUTABLES.get(target);
	if (!runtimedExecutable) {
		throw new Error(`runtimed is not configured for ${platform}/${arch}`);
	}
	const requiredAssets = [
		path.join(stagedNotebookBundle, "index.html"),
		path.join(stagedNotebookBundle, "staged.json"),
		path.join(stagedNteractMcp, target, nteractMcpExecutables.nteractMcp),
		path.join(stagedNteractMcp, target, nteractMcpExecutables.runt),
		path.join(stagedNteractMcp, target, "staged.json"),
		path.join(stagedRuntimed, target, runtimedExecutable),
		path.join(stagedRuntimed, target, "staged.json"),
	];

	for (const requiredAsset of requiredAssets) {
		if (!exists(requiredAsset)) {
			throw new Error(
				`Staged notebook asset is missing: ${requiredAsset}. Run the notebook plugin's prepare-assets script.`,
			);
		}
	}

	return {
		extraResources: [stagedNotebookBundle, stagedNteractMcp, stagedRuntimed],
		asarUnpackPackages: NOTEBOOK_ASAR_UNPACK_PACKAGES,
	};
}
