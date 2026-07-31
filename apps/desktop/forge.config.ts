import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execa } from "execa";

import {
	getArtifactKey,
	getReleaseChannel,
	getUpdateFeedUrl,
	getUpdatePublishUrl,
} from "./config/release.js";
import { getAppIdentity } from "./config/app-identity.js";
import { planWindowsSigning, resolveOsxNotarize, resolveOsxSign } from "./config/signing.js";
import { stageWebRenderer } from "./config/stage-web-renderer.js";
import { signWindowsFile } from "./config/windows-sign.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../..");
const webDistDirectory = path.join(workspaceRoot, "apps/web/dist");
const channel = getReleaseChannel(process.env);
const identity = getAppIdentity(channel);
const publishUrl = getUpdatePublishUrl(process.env);
const s3Bucket = process.env.UPDATE_S3_BUCKET?.trim();
const osxSign = resolveOsxSign(process.env);
const osxNotarize = resolveOsxNotarize(process.env);
const windowsPlan = planWindowsSigning(process.env);
const executableName =
	process.platform === "darwin" ? identity.productName : identity.executableName;
const appIcon =
	process.platform === "darwin"
		? [path.join(packageRoot, "assets/icon.icns"), path.join(packageRoot, "assets/icon.icon")]
		: path.join(packageRoot, "assets/icon");

function updateFeed(platform: string, arch: string): string | undefined {
	return getUpdateFeedUrl({ publishUrl, channel, platform, arch });
}

async function stageProductionDependencies(buildPath: string): Promise<void> {
	const stagingDirectory = await mkdtemp(
		path.join(workspaceRoot, ".anaconda-agentic-desktop-production-"),
	);

	try {
		await execa(
			"pnpm",
			[
				"--filter",
				"@anaconda-agentic-desktop/desktop",
				"deploy",
				"--prod",
				"--ignore-scripts",
				"--offline",
				"--frozen-lockfile",
				stagingDirectory,
			],
			{
				cwd: workspaceRoot,
				env: { HUSKY: "0" },
				stderr: "inherit",
				stdout: "inherit",
			},
		);
		await cp(path.join(stagingDirectory, "node_modules"), path.join(buildPath, "node_modules"), {
			recursive: true,
		});
		await rm(path.join(buildPath, "node_modules", ".bin"), {
			force: true,
			recursive: true,
		});
	} finally {
		await rm(stagingDirectory, { force: true, recursive: true });
	}
}

const config: ForgeConfig = {
	packagerConfig: {
		asar: {
			unpack: "**/node_modules/{better-sqlite3,@github/keytar}/**",
		},
		appBundleId: identity.appBundleId,
		appCategoryType: "public.app-category.developer-tools",
		executableName,
		extraResource: path.join(packageRoot, "assets/icon.png"),
		icon: appIcon,
		name: identity.productName,
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
	rebuildConfig: {},
	makers: [
		{
			name: "@electron-forge/maker-dmg",
			platforms: ["darwin"],
			config: {},
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
					setupExe: identity.setupExecutableName,
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
					homepage: "https://github.com/anaconda/agentic-desktop",
					icon: path.join(packageRoot, "assets/icon.png"),
					maintainer: "Anaconda, Inc.",
					name: identity.executableName,
					productName: identity.productName,
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
				}) => getArtifactKey({ channel, platform, arch, fileName }),
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
		packageAfterCopy: async (_forgeConfig, buildPath) => {
			await stageWebRenderer(buildPath, webDistDirectory);
			await stageProductionDependencies(buildPath);
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
