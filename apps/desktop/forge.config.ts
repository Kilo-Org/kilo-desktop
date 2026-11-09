import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execa } from "execa";

import {
	getArtifactKey,
	getPreviewBuildTime,
	getNativeAppVersion,
	getPublishAppVersion,
	getReleaseTrack,
	getUpdateFeedUrl,
	getUpdatePublishUrl,
} from "./config/release.js";
import desktopPackage from "./package.json" with { type: "json" };
import {
	getAppCopyright,
	getAppIdentity,
	getDmgVolumeTitle,
	getVersionedSetupExecutableName,
} from "./config/app-identity.js";
import { planWindowsSigning, resolveOsxNotarize, resolveOsxSign } from "./config/signing.js";
import { stageWebRenderer } from "./config/stage-web-renderer.js";
import { getWindowsPackagingTempDirectory } from "./config/windows-packaging-temp.js";
import { signWindowsFile } from "./config/windows-sign.js";
import { bundleVcRuntime, createVisualStudioRedistLocator } from "./config/windows-vc-runtime.js";
import { pruneProductionDependencies } from "./config/prune-production-dependencies.js";
import { assertNoShippedSource } from "./config/assert-no-shipped-source.js";
import { writeAppLegalFiles } from "./config/third-party-notices.js";
import { listWorkspacePackageNames } from "./config/workspace-packages.js";
import { createNotebookPackagingPlan } from "@kilo-desktop/plugin-notebook/packaging";
import { createBridgePackagingPlan } from "@kilo-desktop/plugin-environments/packaging";
import { ensureNodePtySpawnHelpersExecutable } from "@kilo-desktop/plugin-terminal/packaging";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../..");
const webDistDirectory = path.join(workspaceRoot, "apps/web/dist");
const track = getReleaseTrack(process.env);
const buildTime = getPreviewBuildTime(process.env);
const appVersion = getPublishAppVersion({
	version: desktopPackage.version,
	track,
	...(process.env.RELEASE_VERSION ? { releaseVersion: process.env.RELEASE_VERSION } : {}),
	now: buildTime,
});
const nativeAppVersion = getNativeAppVersion(appVersion);
const identity = getAppIdentity(track);
const dmgVolumeTitle = getDmgVolumeTitle(track);
const publishUrl = getUpdatePublishUrl(process.env);
const s3Bucket = process.env.UPDATE_S3_BUCKET?.trim();
const skipNativeRebuild = process.env.ELECTRON_SKIP_NATIVE_REBUILD === "true";
const osxSign = resolveOsxSign(process.env);
const osxNotarize = resolveOsxNotarize(process.env);
const windowsPlan = planWindowsSigning(process.env);
const windowsPackagingTemp = getWindowsPackagingTempDirectory({
	platform: process.platform,
	driveRoot: path.parse(packageRoot).root,
	...(process.env.WINDOWS_PACKAGING_TEMP ? { override: process.env.WINDOWS_PACKAGING_TEMP } : {}),
});
const executableName =
	process.platform === "darwin" ? identity.productName : identity.executableName;
const macIcon = track === "preview" ? "icon-preview.icon" : "icon.icon";
const appIcon =
	process.platform === "darwin"
		? [path.join(packageRoot, `assets/${macIcon}`), path.join(packageRoot, "assets/icon.icns")]
		: path.join(packageRoot, "assets/icon");

const notebookPackaging = createNotebookPackagingPlan();
const bridgePackaging = createBridgePackagingPlan();
const parcelWatcherBindingPackages = [
	"@parcel/watcher-android-arm64",
	"@parcel/watcher-darwin-arm64",
	"@parcel/watcher-darwin-x64",
	"@parcel/watcher-freebsd-x64",
	"@parcel/watcher-linux-arm-glibc",
	"@parcel/watcher-linux-arm-musl",
	"@parcel/watcher-linux-arm64-glibc",
	"@parcel/watcher-linux-arm64-musl",
	"@parcel/watcher-linux-x64-glibc",
	"@parcel/watcher-linux-x64-musl",
	"@parcel/watcher-win32-arm64",
	"@parcel/watcher-win32-x64",
];
const asarUnpackPackages = [
	"better-sqlite3",
	"@github/keytar",
	// @parcel/watcher loads its native binding from a platform package. Keep
	// that binding in the app bundle so macOS signs it with the app identity
	// instead of Electron extracting the upstream-signed binary at runtime.
	...parcelWatcherBindingPackages,
	"node-pty",
	...notebookPackaging.asarUnpackPackages,
];
const extraResources = [
	path.join(packageRoot, "assets/icon.png"),
	// Copied over Squirrel's app.ico by the install hook (SquirrelUninstallIcon.ts).
	...(process.platform === "win32" ? [path.join(packageRoot, "assets/icon.ico")] : []),
	// Native plugin payloads must stay outside ASAR so the shell can execute them.
	path.join(workspaceRoot, "plugins/agent/resources/kilo"),
	// kilo.terminal's frame, served on its embedded host from the app's resources.
	path.join(workspaceRoot, "plugins/terminal/resources/terminal"),
	...notebookPackaging.extraResources,
	...bridgePackaging.extraResources,
];

// Vite `build.license` lists of every bundle that ships, read by
// writeAppLegalFiles. Paths under the build folder are the staged renderer and
// main/preload; the rest ship as resources or inside the renderer.
const shippedBundleLicenseFiles = (buildPath: string): string[] => [
	...[
		".vite/renderer/main_window/.vite/licenses.json",
		".vite/build/.vite/licenses.main.json",
		".vite/build/.vite/licenses.preload.json",
	].map((file) => path.join(buildPath, file)),
	...[
		"plugins/terminal/resources/terminal/.vite/licenses.json",
		"plugins/notebook/resources/kilo-plugin/.vite/licenses.json",
	].map((file) => path.join(workspaceRoot, file)),
];

async function moveDirectory(source: string, destination: string): Promise<void> {
	await rm(destination, { force: true, recursive: true });
	try {
		await rename(source, destination);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await cp(source, destination, { recursive: true });
		await rm(source, { force: true, recursive: true });
	}
}

function updateFeed(platform: string, arch: string): string | undefined {
	return getUpdateFeedUrl({ publishUrl, track, platform, arch });
}

async function stageProductionDependencies(
	buildPath: string,
	workspacePackageNames: readonly string[],
): Promise<void> {
	const stagingDirectory = await mkdtemp(path.join(workspaceRoot, ".kilo-desktop-production-"));
	const linkedDependencies = [
		{
			packageName: "@kilo-desktop/plugin-agent",
			source: path.join(workspaceRoot, "plugins/agent"),
			excludedDirectories: new Set([
				".git",
				".vitest",
				"coverage",
				"e2e",
				"node_modules",
				"resources",
			]),
		},
		{
			packageName: "@kilo-desktop/plugin-notebook",
			source: path.join(workspaceRoot, "plugins/notebook"),
			excludedDirectories: new Set([
				".git",
				".vitest",
				"build",
				"coverage",
				"e2e",
				"node_modules",
				"resources",
			]),
		},
		{
			packageName: "@kilo-desktop/plugin-terminal",
			source: path.join(workspaceRoot, "plugins/terminal"),
			excludedDirectories: new Set([
				".git",
				".vitest",
				"coverage",
				"e2e",
				"node_modules",
				"resources",
			]),
		},
		{
			packageName: "@kilo-desktop/plugin-environments",
			source: path.join(workspaceRoot, "plugins/environments"),
			excludedDirectories: new Set([
				".git",
				".vitest",
				"coverage",
				"e2e",
				"node_modules",
				"resources",
				"scripts",
			]),
		},
	] as const;

	try {
		// Modern deploy consumes the committed workspace lockfile. Keep the build
		// offline and frozen so release artifacts cannot drift when a compatible
		// transitive version is published after the lockfile was reviewed.
		// PNPM_CONFIG_TRUST_LOCKFILE (env — the --config flag does not reach
		// deploy's inner install): the offline supply-chain re-verification
		// needs each lockfile entry's publish date from the full-metadata
		// mirror, which only resolution-time fetches populate — offline it
		// fails with ERR_PNPM_NO_OFFLINE_META. The gate already ran online on
		// the same lockfile at the root `pnpm install`, and deploy is frozen,
		// so re-verification here is redundant.
		await execa(
			"pnpm",
			[
				"--config.allowUnusedPatches=true",
				"--filter",
				"@kilo-desktop/desktop",
				"deploy",
				"--prod",
				"--ignore-scripts",
				"--offline",
				"--frozen-lockfile",
				stagingDirectory,
			],
			{
				cwd: workspaceRoot,
				env: { HUSKY: "0", PNPM_CONFIG_TRUST_LOCKFILE: "true" },
				stderr: "inherit",
				stdout: "inherit",
			},
		);
		for (const dependency of linkedDependencies) {
			const destination = path.join(stagingDirectory, "node_modules", dependency.packageName);
			await rm(destination, { force: true, recursive: true });
			await cp(dependency.source, destination, {
				filter: (source) => {
					const relativePath = path.relative(dependency.source, source);
					const topLevelDirectory = relativePath.split(path.sep)[0];
					return !topLevelDirectory || !dependency.excludedDirectories.has(topLevelDirectory);
				},
				recursive: true,
			});
		}
		const stagedNodeModules = path.join(stagingDirectory, "node_modules");
		await pruneProductionDependencies(stagedNodeModules, workspacePackageNames);
		const packagedNodeModules = path.join(buildPath, "node_modules");
		await moveDirectory(stagedNodeModules, packagedNodeModules);
		// pnpm deploy creates `.bin` directories (top-level and nested inside
		// individual packages, e.g. `@opentelemetry/configuration/node_modules/.bin`)
		// whose symlinks resolve to paths outside the app. `@electron/asar` refuses
		// symlinks that "link out of the package", so strip every `.bin` before
		// packing. No app code invokes anything via `.bin` (unpacked native
		// binaries are spawned by file path), so removing them all is safe.
		await removeBinDirectories(path.join(buildPath, "node_modules"));
	} finally {
		await rm(stagingDirectory, { force: true, recursive: true });
	}
}

async function removeBinDirectories(directory: string): Promise<void> {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const entryPath = path.join(directory, entry.name);
		if (entry.name === ".bin") {
			await rm(entryPath, { force: true, recursive: true });
			continue;
		}
		await removeBinDirectories(entryPath);
	}
}

async function stampPackagedAppVersion(buildPath: string, version: string): Promise<void> {
	const manifestPath = path.join(buildPath, "package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
	manifest.version = version;
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

const config: ForgeConfig = {
	packagerConfig: {
		asar: {
			// Native addons need real filesystem paths. All other production
			// dependencies remain inside the integrity-checked ASAR.
			// Keep this a single-level brace list. Wrapping it in another `{…}`
			// makes @electron/asar match nothing, so signed builds die on
			// `require("@runtimed/node")` with the .node still inside app.asar.
			unpack: `**/node_modules/{${asarUnpackPackages.join(",")}}/**`,
		},
		appBundleId: identity.appBundleId,
		appCategoryType: "public.app-category.developer-tools",
		appCopyright: getAppCopyright(buildTime),
		// Windows PE FileVersion/ProductVersion accept at most four numeric
		// components. Keep the preview prerelease on package.json and makers.
		appVersion: nativeAppVersion,
		executableName,
		extraResource: extraResources,
		icon: appIcon,
		name: identity.productName,
		protocols: [{ name: identity.productName, schemes: ["kilo-desktop"] }],
		...(windowsPackagingTemp ? { tmpdir: windowsPackagingTemp } : {}),
		// Production node_modules are staged in packageAfterCopy via `pnpm deploy`.
		// Packager prune runs `pnpm install --production` against this workspace
		// package and can wipe the repo's node_modules (Forge is a devDependency).
		prune: false,
		ignore: (file) => {
			if (!file) return false;
			// Allowlist: package manifest and built main/preload. Plugin drizzle
			// migrations ship inside node_modules via pnpm deploy (see
			// stageProductionDependencies), not from the app source tree.
			const keepRoots = ["/package.json", "/.vite"];
			return !keepRoots.some(
				(root) =>
					file === root ||
					file.startsWith(`${root}/`) ||
					// Keep parent directories of a kept root so the packager descends into them.
					root.startsWith(`${file}/`),
			);
		},
		beforeAsar: [
			async ({ buildPath, platform, arch }) => {
				const workspacePackageNames = await listWorkspacePackageNames(workspaceRoot);
				await stampPackagedAppVersion(buildPath, appVersion);
				await stageWebRenderer(buildPath, webDistDirectory);
				await stageProductionDependencies(buildPath, workspacePackageNames);
				await ensureNodePtySpawnHelpersExecutable(
					path.join(buildPath, "node_modules", "node-pty"),
					platform,
					arch,
				);
				await assertNoShippedSource(buildPath, workspacePackageNames);
				await writeAppLegalFiles({
					buildPath,
					platform,
					productName: identity.productName,
					license: path.join(workspaceRoot, "LICENSE.md"),
					bundleLicenseFiles: shippedBundleLicenseFiles(buildPath),
					packageSearchRoots: [path.join(workspaceRoot, "node_modules")],
					workspacePackageNames,
					componentNotices: bridgePackaging.notices
						? [
								{
									title: "Conda bridge (bridge/)",
									preamble:
										"The conda bridge in the bridge/ folder bundles CPython and the packages below.\nThe GNU license texts its entries refer to are in bridge/licenses/.",
									file: bridgePackaging.notices,
								},
							]
						: [],
				});
			},
		],
		win32metadata: {
			CompanyName: "Anaconda, Inc.",
			FileDescription: identity.productName,
			InternalName: identity.squirrelName,
			OriginalFilename: `${identity.executableName}.exe`,
			ProductName: identity.productName,
		},
		...(osxSign ? { osxSign } : {}),
		...(osxNotarize ? { osxNotarize } : {}),
		...(windowsPlan.packager ? { windowsSign: windowsPlan.packager } : {}),
	},
	rebuildConfig: {
		// E2E uses the packages' N-API prebuilds; releases retain Forge's rebuild
		// pass and persist its default-off cache in-tree for CI restoration.
		...(skipNativeRebuild ? { types: [] } : {}),
		useCache: true,
		cachePath: path.join(packageRoot, ".electron-rebuild-cache"),
	},
	makers: [
		{
			name: "@electron-forge/maker-dmg",
			platforms: ["darwin"],
			config: {
				// appdmg's alias encoder limits volume names to 27 characters. Keep
				// enough headroom for the suffix macOS adds when a volume name collides.
				title: dmgVolumeTitle,
				icon: path.join(packageRoot, "assets/volume-icon.icns"),
				// A pre-merged 1x+2x LZW TIFF: given a PNG pair, appdmg merges them via
				// tiffutil uncompressed, which can overflow its scratch volume. Finder
				// pins the picture top-left and paints white past its edge, so the
				// 660x400 art sits on an oversized canvas filled with its edge colour to
				// keep window resizes seamless. Icon centres flank the arrow in the art.
				background: path.join(packageRoot, "assets/dmg-background.tiff"),
				iconSize: 128,
				format: "ULFO",
				contents: (opts: { appPath: string }) => [
					{ x: 170, y: 200, type: "file", path: opts.appPath },
					{ x: 490, y: 200, type: "link", path: "/Applications" },
				],
				additionalDMGOptions: {
					window: { size: { width: 660, height: 400 } },
				},
			},
		},
		{
			name: "@electron-forge/maker-zip",
			platforms: ["darwin"],
			config: (arch: string) => {
				const baseUrl = updateFeed("darwin", arch);
				return baseUrl ? { macUpdateManifestBaseUrl: baseUrl } : {};
			},
		},
		{
			name: "@electron-forge/maker-squirrel",
			platforms: ["win32"],
			config: (arch: string) => {
				const remoteReleases =
					process.env.UPDATE_REMOTE_RELEASES === "true" ? updateFeed("win32", arch) : undefined;
				return {
					name: identity.squirrelName,
					// Squirrel copies this into the Start menu/desktop shortcut comment,
					// which Windows shows as the icon's hover tooltip. Without it,
					// electron-winstaller falls back to package.json's description.
					description: identity.productName,
					setupExe: getVersionedSetupExecutableName(identity, appVersion, arch),
					setupIcon: path.join(packageRoot, "assets/icon.ico"),
					version: appVersion,
					loadingGif: path.join(packageRoot, "assets/installing-kilo.gif"),
					...(remoteReleases ? { remoteReleases } : {}),
					...(windowsPlan.squirrelCertificate ?? {}),
				};
			},
		},
		{
			name: "@electron-forge/maker-deb",
			platforms: ["linux"],
			config: {
				options: {
					bin: identity.executableName,
					categories: ["Development"],
					homepage: "https://kilo.ai",
					icon: path.join(packageRoot, "assets/icon.png"),
					maintainer: "Anaconda, Inc.",
					name: identity.executableName,
					productName: identity.productName,
					version: appVersion,
					mimeType: ["x-scheme-handler/kilo-desktop"],
				},
			},
		},
	],
	publishers: [
		{
			name: "@electron-forge/publisher-s3",
			config: {
				...(s3Bucket ? { bucket: s3Bucket } : {}),
				...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
				omitAcl: true,
				keyResolver: ({
					fileName,
					platform,
					arch,
				}: {
					fileName: string;
					platform: string;
					arch: string;
				}) => getArtifactKey({ track, platform, arch, fileName }),
				releaseFileCacheControlMaxAge: 60,
			},
		},
	],
	plugins: [
		new VitePlugin({
			build: [
				{
					entry: "src/main/main.ts",
					config: "vite.main.config.ts",
					target: "main",
				},
				{
					entry: "src/preload/preload.ts",
					config: "vite.preload.config.ts",
					target: "preload",
				},
			],
			renderer: [],
		}),
		new FusesPlugin({
			version: FuseVersion.V1,
			// Off (Electron's recommended default): nothing in the app runs its
			// binary as Node. Kilo reaches the WebMCP tools over the main
			// process's MCP endpoint (docs/agent-tools.md).
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			// Playwright's electron.launch requires --inspect to work (waits for
			// "Debugger listening on"). Enable for e2e packages only; keep off in
			// production release builds.
			[FuseV1Options.EnableNodeCliInspectArguments]: process.env.ELECTRON_ENABLE_INSPECT === "true",
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
	hooks: {
		// Runs for `package` and `make`, so every Windows build (including the
		// e2e package) fails if a shipped binary needs a runtime DLL it lacks.
		postPackage: async (_forgeConfig, { platform, outputPaths }) => {
			if (platform !== "win32") return;
			const locateDll = createVisualStudioRedistLocator();
			for (const outputPath of outputPaths) {
				await bundleVcRuntime(outputPath, locateDll);
			}
		},
		postMake: async (_forgeConfig, makeResults) => {
			if (!windowsPlan.postMakeSign) return makeResults;
			for (const result of makeResults) {
				for (const artifact of result.artifacts) {
					if (artifact.toLowerCase().endsWith(".exe")) {
						await signWindowsFile(artifact);
					}
				}
			}
			return makeResults;
		},
	},
};

export default config;
