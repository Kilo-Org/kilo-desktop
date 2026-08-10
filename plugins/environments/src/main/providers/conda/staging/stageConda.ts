import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { execa } from "execa";

import type { MainSdkFetch, MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import { getMinicondaInstaller, type MinicondaInstallerArtifact } from "./artifacts.js";
import { StagingError } from "./errors.js";

export interface StagingContext {
	readonly storageDir: string;
	readonly fetch: MainSdkFetch;
	readonly logger: MainSdkLogger;
	readonly reportProgress: (message: string) => void;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
}

interface StagedManifest {
	readonly installerSha256: string;
	readonly target: string;
}

function providerRoot(storageDir: string): string {
	return path.join(storageDir, "providers", "conda");
}

function prefixPath(storageDir: string): string {
	return path.join(providerRoot(storageDir), "prefix");
}

function manifestPath(storageDir: string): string {
	return path.join(providerRoot(storageDir), "staged.json");
}

function cacheDir(storageDir: string): string {
	return path.join(providerRoot(storageDir), "installer-cache");
}

/**
 * Normalize a relative path stored with Windows backslashes to the current
 * OS path separator. Allows `condaBinRelPath: "Scripts\\conda.exe"` to work
 * correctly on all platforms.
 */
function normalizeRelPath(relPath: string): string {
	return relPath.replace(/[\\/]/g, path.sep);
}

async function isAlreadyStaged(
	storageDir: string,
	artifact: MinicondaInstallerArtifact,
): Promise<boolean> {
	try {
		const raw = await readFile(manifestPath(storageDir), "utf8");
		const manifest = JSON.parse(raw) as StagedManifest;
		if (
			manifest.installerSha256 !== artifact.installerSha256 ||
			manifest.target !== artifact.target
		) {
			return false;
		}
		await access(path.join(prefixPath(storageDir), normalizeRelPath(artifact.condaBinRelPath)));
		return true;
	} catch {
		return false;
	}
}

async function computeFileSha256(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	await pipeline(stream, hash);
	return hash.digest("hex");
}

async function ensureInstallerCached(
	ctx: StagingContext,
	artifact: MinicondaInstallerArtifact,
): Promise<string> {
	const dir = cacheDir(ctx.storageDir);
	await mkdir(dir, { recursive: true });

	const basename = path.basename(new URL(artifact.installerUrl).pathname);
	const cachedPath = path.join(dir, `${artifact.installerSha256}-${basename}`);

	try {
		const existingSha = await computeFileSha256(cachedPath);
		if (existingSha === artifact.installerSha256) {
			ctx.logger.info("Installer cache hit — skipping download.");
			return cachedPath;
		}
	} catch {
		// File doesn't exist or is unreadable — proceed with download.
	}

	ctx.reportProgress("Downloading Miniconda installer\u2026");
	ctx.logger.info(`Downloading installer from ${artifact.installerUrl}`);

	let response: Response;
	try {
		response = await ctx.fetch(artifact.installerUrl);
	} catch (error) {
		throw new StagingError(
			`Failed to fetch installer: ${error instanceof Error ? error.message : String(error)}`,
			"INSTALLER_DOWNLOAD_FAILED",
		);
	}

	if (!response.ok) {
		throw new StagingError(
			`Installer download failed: HTTP ${response.status} ${response.statusText}`,
			"INSTALLER_DOWNLOAD_FAILED",
		);
	}

	if (!response.body) {
		throw new StagingError(
			"Installer download failed: empty response body.",
			"INSTALLER_DOWNLOAD_FAILED",
		);
	}

	const tempPath = path.join(dir, `.downloading-${Date.now()}-${basename}`);
	try {
		const hash = createHash("sha256");
		const fileStream = createWriteStream(tempPath);
		const nodeReadable = Readable.fromWeb(response.body as unknown as NodeWebReadableStream);
		nodeReadable.on("data", (chunk: Buffer) => hash.update(chunk));
		await pipeline(nodeReadable, fileStream);

		const digest = hash.digest("hex");
		if (digest !== artifact.installerSha256) {
			throw new StagingError(
				`Installer SHA256 mismatch: expected ${artifact.installerSha256}, got ${digest}.`,
				"INSTALLER_SHA_MISMATCH",
			);
		}

		await rename(tempPath, cachedPath);
		return cachedPath;
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
}

async function runInstaller(
	ctx: StagingContext,
	installerPath: string,
	stagingPrefix: string,
	artifact: MinicondaInstallerArtifact,
): Promise<void> {
	ctx.reportProgress("Installing Miniconda\u2026");
	ctx.logger.info(`Running installer into ${stagingPrefix}`);

	const isWindows = (ctx.platform ?? process.platform) === "win32";
	const command = isWindows ? installerPath : "bash";
	const args = isWindows
		? ["/InstallationType=JustMe", "/RegisterPython=0", "/AddToPath=0", "/S", `/D=${stagingPrefix}`]
		: [installerPath, "-b", "-p", stagingPrefix];

	try {
		const subprocess = execa(command, args, { all: true });
		subprocess.all?.on("data", (chunk: Buffer) => {
			const line = chunk.toString().trim();
			if (line) ctx.reportProgress(line);
		});
		await subprocess;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Miniconda installer exited with an error.";
		throw new StagingError(message, "STAGING_FAILED");
	}

	try {
		await access(path.join(stagingPrefix, normalizeRelPath(artifact.condaBinRelPath)));
	} catch {
		throw new StagingError(
			`Installer completed but conda binary not found at ${artifact.condaBinRelPath}.`,
			"STAGING_FAILED",
		);
	}
}

async function replaceStaging(targetDir: string, stagedDir: string): Promise<void> {
	const backup = `${targetDir}.previous`;
	await rm(backup, { recursive: true, force: true });
	try {
		await rename(targetDir, backup);
	} catch {
		// First staging run — nothing to back up.
	}
	try {
		await rename(stagedDir, targetDir);
	} catch (error) {
		try {
			await rename(backup, targetDir);
		} catch {
			// Preserve the original failure when no backup existed.
		}
		throw error;
	}
	// Best-effort cleanup — failure here must not invalidate the swap.
	await rm(backup, { recursive: true, force: true }).catch(() => {});
}

/**
 * Stage a Miniconda installation into the plugin's scoped prefix.
 *
 * Idempotent: short-circuits if `staged.json` matches the current artifact
 * and the conda binary exists. Otherwise downloads the installer (cached),
 * verifies its SHA256, runs the silent install into a temp prefix, and
 * atomically swaps it into place.
 */
export async function stageConda(ctx: StagingContext): Promise<void> {
	const artifact = getMinicondaInstaller(
		ctx.platform ?? process.platform,
		ctx.arch ?? process.arch,
	);

	if (await isAlreadyStaged(ctx.storageDir, artifact)) {
		ctx.logger.info("Conda base already staged — skipping.");
		return;
	}

	const root = providerRoot(ctx.storageDir);
	await mkdir(root, { recursive: true });

	const installerPath = await ensureInstallerCached(ctx, artifact);

	const stagingPrefix = path.join(root, `.staging-${Date.now()}`);
	await mkdir(stagingPrefix, { recursive: true });

	try {
		await runInstaller(ctx, installerPath, stagingPrefix, artifact);
		await replaceStaging(prefixPath(ctx.storageDir), stagingPrefix);
	} finally {
		await rm(stagingPrefix, { recursive: true, force: true });
	}

	await writeFile(
		manifestPath(ctx.storageDir),
		`${JSON.stringify(
			{
				installerSha256: artifact.installerSha256,
				target: artifact.target,
			} satisfies StagedManifest,
			null,
			"\t",
		)}\n`,
	);

	ctx.reportProgress("Conda base ready.");
	ctx.logger.info("Conda staging complete.");
}
