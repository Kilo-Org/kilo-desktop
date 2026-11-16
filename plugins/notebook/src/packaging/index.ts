import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Forge evaluates this exported module directly in a plain Node subprocess.
// Keep its target layout self-contained so config loading does not depend on
// TypeScript's source-extension resolution before Vite has started.
const RUNTIMED_EXECUTABLES = new Map([
	["darwin-arm64", "runtimed"],
	["darwin-x64", "runtimed"],
	["linux-x64", "runtimed"],
	["linux-arm64", "runtimed"],
	["win32-arm64", "runtimed.exe"],
	["win32-x64", "runtimed.exe"],
]);
// The Kilo server loads the notebook tool plugin, which requires the unpacked
// @runtimed/node by path. That server is not Electron and cannot read app.asar,
// so every runtime dependency of @runtimed/node (`rxjs`) must be unpacked alongside it.
//
// `koffi` is loaded lazily by the daemon peer-credential check, so it must stay
// outside ASAR and be externalized from the bundled main process just like the
// other native runtime dependencies. Critically, koffi ships NO addon of its
// own: its loader requires `koffi.node` from a sibling platform package
// `@koromix/koffi-<platform>-<arch>`. Under the hoisted node linker that package
// hoists to the top level, so it must be unpacked too — otherwise the addon
// stays inside app.asar, koffi fails to load in packaged builds, and every
// daemon is silently denied while `pnpm dev` (unpacked) keeps working.
// `@koromix` is a scope, not a package: it unpacks every installed platform
// package under it, but pnpm only installs the one matching the current
// platform/arch, so exactly one `@koromix/koffi-*` is ever present per build.
export const NOTEBOOK_ASAR_UNPACK_PACKAGES = ["@runtimed", "rxjs", "koffi", "@koromix"] as const;
export const NOTEBOOK_MAIN_EXTERNALS = [/^@runtimed\/node(?:\/.*)?$/, /^koffi$/] as const;

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
	const stagedNotebookBundle = path.join(pluginRoot, "resources/notebook");
	const stagedKiloPlugin = path.join(pluginRoot, "resources/kilo-plugin");
	const stagedRuntimed = path.join(pluginRoot, "resources/runtimed");
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const target = `${platform}-${arch}`;
	const runtimedExecutable = RUNTIMED_EXECUTABLES.get(target);
	if (!runtimedExecutable) {
		throw new Error(`runtimed is not configured for ${platform}/${arch}`);
	}
	const requiredAssets = [
		path.join(stagedNotebookBundle, "index.html"),
		path.join(stagedNotebookBundle, "staged.json"),
		path.join(stagedKiloPlugin, "index.js"),
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
		extraResources: [stagedNotebookBundle, stagedKiloPlugin, stagedRuntimed],
		asarUnpackPackages: NOTEBOOK_ASAR_UNPACK_PACKAGES,
	};
}
