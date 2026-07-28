import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

import {
	getArtifactKey,
	getReleaseChannel,
	getUpdateFeedUrl,
	getUpdatePublishUrl,
} from "./config/release.js";

const execFile = promisify(execFileCallback);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.dirname(appRoot);
const channel = getReleaseChannel(process.env);
const publishUrl = getUpdatePublishUrl(process.env);
const s3Bucket = process.env.UPDATE_S3_BUCKET?.trim();

function updateFeed(platform: string, arch: string): string | undefined {
	return getUpdateFeedUrl({ publishUrl, channel, platform, arch });
}

const macIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const appleId = process.env.APPLE_ID?.trim();
const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
const appleTeamId = process.env.APPLE_TEAM_ID?.trim();
const windowsCertificateFile = process.env.WINDOWS_CERTIFICATE_FILE?.trim();
const windowsCertificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;

async function stageProductionDependencies(buildPath: string): Promise<void> {
	const stagingDirectory = await mkdtemp(
		path.join(os.tmpdir(), "anaconda-agentic-desktop-production-"),
	);
	const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

	try {
		await execFile(
			pnpmCommand,
			[
				"--filter",
				"@anaconda-desktop/app",
				"deploy",
				"--prod",
				"--ignore-scripts",
				"--offline",
				"--frozen-lockfile",
				stagingDirectory,
			],
			{
				cwd: workspaceRoot,
				env: { ...process.env, HUSKY: "0" },
				maxBuffer: 10 * 1024 * 1024,
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
			unpack: "**/node_modules/better-sqlite3/**",
		},
		appBundleId: "com.anaconda.agentic-desktop",
		appCategoryType: "public.app-category.developer-tools",
		executableName: "anaconda-agentic-desktop",
		name: "Anaconda Agentic Desktop",
		ignore: (file) => {
			if (!file) return false;
			return !(
				file === "/package.json" ||
				file === "/.vite" ||
				file.startsWith("/.vite/") ||
				file === "/drizzle" ||
				file.startsWith("/drizzle/")
			);
		},
		win32metadata: {
			CompanyName: "Anaconda, Inc.",
			FileDescription: "Anaconda Agentic Desktop",
			InternalName: "AnacondaAgenticDesktop",
			OriginalFilename: "anaconda-agentic-desktop.exe",
			ProductName: "Anaconda Agentic Desktop",
		},
		...(macIdentity ? { osxSign: { identity: macIdentity } } : {}),
		...(appleId && appleIdPassword && appleTeamId
			? {
					osxNotarize: {
						appleId,
						appleIdPassword,
						teamId: appleTeamId,
					},
				}
			: {}),
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
					name: "AnacondaAgenticDesktop",
					setupExe: "Anaconda-Agentic-Desktop-Setup.exe",
					...(remoteReleases ? { remoteReleases } : {}),
					...(windowsCertificateFile
						? {
								certificateFile: windowsCertificateFile,
								certificatePassword: windowsCertificatePassword,
							}
						: {}),
				};
			},
		},
		{
			name: "@electron-forge/maker-deb",
			platforms: ["linux"],
			config: {
				options: {
					categories: ["Development"],
					homepage: "https://github.com/anaconda/agentic-desktop",
					maintainer: "Anaconda, Inc.",
				},
			},
		},
		{
			name: "@electron-forge/maker-rpm",
			platforms: ["linux"],
			config: {
				options: {
					categories: ["Development"],
					homepage: "https://github.com/anaconda/agentic-desktop",
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
				public: true,
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
			renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
		}),
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
	hooks: {
		packageAfterCopy: async (_forgeConfig, buildPath) => {
			await stageProductionDependencies(buildPath);
		},
	},
};

export default config;
