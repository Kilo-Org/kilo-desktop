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
import { detectSystemConda } from "./detectSystemConda.js";
import { StagingError } from "./errors.js";

export interface StagingContext {
	readonly storageDir: string;
	readonly fetch: MainSdkFetch;
	readonly logger: MainSdkLogger;
	readonly reportProgress: (message: string) => void;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
}

export interface StagingResult {
	/** Absolute path to the resolved conda binary. */
	readonly condaBinPath: string;
	/** Whether the conda installation is system-provided or bundled by the plugin. */
	readonly strategy: "system" | "bundled";
}

// ─── Staged manifest ─────────────────────────────────────────────────────────

interface StagedManifestSystem {
	readonly type: "system";
	readonly condaBinPath: string;
	readonly condaVersion: string;
	readonly target: string;
}

interface StagedManifestBundled {
	readonly type: "bundled";
	readonly installerSha256: string;
	readonly target: string;
}

/**
 * Legacy format (pre-system-detection) — treated as "bundled".
 */
interface StagedManifestLegacy {
	readonly installerSha256: string;
	readonly target: string;
	readonly type?: undefined;
}

type StagedManifest = StagedManifestSystem | StagedManifestBundled | StagedManifestLegacy;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
 * OS path separator.
 */
function normalizeRelPath(relPath: string): string {
	return relPath.replace(/[\\/]/g, path.sep);
}

// ─── Idempotency checks ──────────────────────────────────────────────────────

async function readManifest(storageDir: string): Promise<StagedManifest | null> {
	try {
		const raw = await readFile(manifestPath(storageDir), "utf8");
		return JSON.parse(raw) as StagedManifest;
	} catch {
		return null;
	}
}

async function checkSystemManifest(
	manifest: StagedManifestSystem,
	logger: MainSdkLogger,
): Promise<StagingResult | null> {
	try {
		await access(manifest.condaBinPath);
		logger.info(`System conda still available at ${manifest.condaBinPath} — skipping staging.`);
		return { condaBinPath: manifest.condaBinPath, strategy: "system" };
	} catch {
		logger.info("Previously detected system conda is no longer accessible — will re-stage.");
		return null;
	}
}

async function checkBundledManifest(
	manifest: StagedManifestBundled | StagedManifestLegacy,
	storageDir: string,
	artifact: MinicondaInstallerArtifact,
	logger: MainSdkLogger,
): Promise<StagingResult | null> {
	if (
		manifest.installerSha256 !== artifact.installerSha256 ||
		manifest.target !== artifact.target
	) {
		return null;
	}
	const binPath = path.join(prefixPath(storageDir), normalizeRelPath(artifact.condaBinRelPath));
	try {
		await access(binPath);
		logger.info("Bundled conda base already staged — skipping.");
		return { condaBinPath: binPath, strategy: "bundled" };
	} catch {
		return null;
	}
}

// ─── Download + install ──────────────────────────────────────────────────────

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

async function writeManifest(storageDir: string, manifest: StagedManifest): Promise<void> {
	await mkdir(providerRoot(storageDir), { recursive: true });
	await writeFile(manifestPath(storageDir), `${JSON.stringify(manifest, null, "\t")}\n`);
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Stage a conda installation for the plugin.
 *
 * Strategy (tried in order):
 * 1. **Idempotency check** — if `staged.json` exists and the conda binary is
 *    still accessible, short-circuit immediately.
 * 2. **System detection** — search for a compatible conda (>= 24.0) on PATH
 *    and in well-known locations. If found, record it in `staged.json` as
 *    `type: "system"` and skip the download entirely.
 * 3. **Bundled install** — download the pinned Miniconda installer, verify
 *    its SHA256, run the silent install into a scoped prefix, and record it
 *    in `staged.json` as `type: "bundled"`.
 *
 * Returns the resolved conda binary path so downstream consumers
 * (CondaService) can invoke it.
 */
export async function stageConda(ctx: StagingContext): Promise<StagingResult> {
	const platform = ctx.platform ?? process.platform;
	const arch = ctx.arch ?? process.arch;
	const artifact = getMinicondaInstaller(platform, arch);

	ctx.logger.info(
		`[conda-staging] Starting — target: ${artifact.target}, storageDir: ${ctx.storageDir}`,
	);

	// 1. Check existing manifest
	const manifest = await readManifest(ctx.storageDir);
	if (manifest) {
		ctx.logger.info(
			`[conda-staging] Found staged.json (type: ${manifest.type ?? "bundled (legacy)"})`,
		);
		if (manifest.type === "system") {
			const result = await checkSystemManifest(manifest, ctx.logger);
			if (result) return result;
		} else {
			const result = await checkBundledManifest(manifest, ctx.storageDir, artifact, ctx.logger);
			if (result) return result;
		}
		ctx.logger.info("[conda-staging] Existing manifest invalid — re-staging.");
	} else {
		ctx.logger.info("[conda-staging] No staged.json found — first run.");
	}

	// 2. Try system conda detection
	ctx.reportProgress("Checking for existing conda installation\u2026");
	const systemConda = await detectSystemConda({ logger: ctx.logger, platform });
	if (systemConda) {
		ctx.reportProgress("Using existing conda installation.");
		const systemManifest: StagedManifestSystem = {
			type: "system",
			condaBinPath: systemConda.condaBinPath,
			condaVersion: systemConda.version,
			target: artifact.target,
		};
		await writeManifest(ctx.storageDir, systemManifest);
		ctx.logger.info(
			`[conda-staging] Strategy: SYSTEM — ${systemConda.version} at ${systemConda.condaBinPath}`,
		);
		return { condaBinPath: systemConda.condaBinPath, strategy: "system" };
	}

	// 3. Fall back to bundled Miniconda install
	ctx.logger.info("[conda-staging] Strategy: BUNDLED — downloading Miniconda installer.");
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

	const bundledManifest: StagedManifestBundled = {
		type: "bundled",
		installerSha256: artifact.installerSha256,
		target: artifact.target,
	};
	await writeManifest(ctx.storageDir, bundledManifest);

	const condaBinPath = path.join(
		prefixPath(ctx.storageDir),
		normalizeRelPath(artifact.condaBinRelPath),
	);
	ctx.reportProgress("Conda base ready.");
	ctx.logger.info("Conda staging complete.");
	return { condaBinPath, strategy: "bundled" };
}
