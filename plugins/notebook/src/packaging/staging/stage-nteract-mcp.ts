import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { execa } from "execa";

import {
	getNteractMcpArtifact,
	NTERACT_RELEASE,
	nteractDownloadUrl,
	type BundledNativeExecutable,
	type NteractMcpArtifact,
	type ReleaseAsset,
} from "../artifacts.js";
import { isNativeExecutable, stagedExecuteBitsAreCurrent } from "./stage-pinned-binary.js";

const require = createRequire(import.meta.url);
const DOWNLOAD_TIMEOUT_MS = 120_000;
const STAGING_MANIFEST = "staged.json";

interface StagingManifest {
	readonly schemaVersion: 1;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly target: string;
	readonly nteractMcp: BundledNativeExecutable;
	readonly runt: BundledNativeExecutable;
}

export interface StageNteractMcpOptions {
	readonly resourceRoot: string;
	readonly artifact?: NteractMcpArtifact;
	readonly sourceNteractMcpPath?: string;
	readonly sourceRuntPath?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
	readonly extract?: (
		sourcePath: string,
		binary: BundledNativeExecutable,
		workingDirectory: string,
	) => Promise<Buffer>;
}

export interface StageNteractMcpResult {
	readonly artifact: NteractMcpArtifact;
	readonly nteractMcpPath: string;
	readonly runtPath: string;
	readonly staged: boolean;
	readonly targetDirectory: string;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function expectedManifest(artifact: NteractMcpArtifact): StagingManifest {
	return {
		schemaVersion: 1,
		releaseTag: NTERACT_RELEASE.tag,
		sourceCommit: NTERACT_RELEASE.commit,
		target: artifact.target,
		nteractMcp: artifact.nteractMcp,
		runt: artifact.runt,
	};
}

async function executableIsCurrent(
	filePath: string,
	binary: BundledNativeExecutable,
	platform: NodeJS.Platform,
): Promise<boolean> {
	const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
	return (
		info.isFile() &&
		stagedExecuteBitsAreCurrent(info.mode, platform) &&
		(await isNativeExecutable(filePath, platform)) &&
		bytes.byteLength === binary.bytes &&
		sha256(bytes) === binary.sha256
	);
}

async function existingStageIsCurrent(
	targetDirectory: string,
	artifact: NteractMcpArtifact,
): Promise<boolean> {
	try {
		const manifest = JSON.parse(
			await readFile(path.join(targetDirectory, STAGING_MANIFEST), "utf8"),
		) as StagingManifest;
		return (
			JSON.stringify(manifest) === JSON.stringify(expectedManifest(artifact)) &&
			(await executableIsCurrent(
				path.join(targetDirectory, artifact.nteractMcp.executable),
				artifact.nteractMcp,
				artifact.platform,
			)) &&
			(await executableIsCurrent(
				path.join(targetDirectory, artifact.runt.executable),
				artifact.runt,
				artifact.platform,
			))
		);
	} catch {
		return false;
	}
}

async function downloadSource(
	source: ReleaseAsset,
	options: StageNteractMcpOptions,
): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
	try {
		const response = await (options.fetch ?? fetch)(nteractDownloadUrl(source.assetName), {
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`could not download ${source.assetName}: HTTP ${response.status}`);
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength !== source.bytes) {
			throw new Error(
				`source size mismatch for ${source.assetName}: expected ${source.bytes}, got ${bytes.byteLength}`,
			);
		}
		const digest = sha256(bytes);
		if (digest !== source.sha256) {
			throw new Error(
				`source SHA-256 mismatch for ${source.assetName}: expected ${source.sha256}, got ${digest}`,
			);
		}
		return bytes;
	} finally {
		clearTimeout(timer);
	}
}

async function extractBinary(
	sourcePath: string,
	binary: BundledNativeExecutable,
	workingDirectory: string,
): Promise<Buffer> {
	if (binary.extraction.kind === "direct") return readFile(sourcePath);

	const extractionDirectory = await mkdtemp(path.join(workingDirectory, ".extract-"));
	try {
		if (binary.extraction.kind === "tar-gz") {
			await execa("tar", [
				"-xzf",
				sourcePath,
				"-C",
				extractionDirectory,
				binary.extraction.entryPath,
			]);
			return readFile(path.join(extractionDirectory, binary.extraction.entryPath));
		}

		const { path7z } = require("7zip-bin-full") as { readonly path7z: string };
		if (process.platform !== "win32") await chmod(path7z, 0o755);
		await execa(path7z, [
			"e",
			sourcePath,
			`-o${extractionDirectory}`,
			binary.extraction.entryPath,
			"-y",
		]);
		return readFile(path.join(extractionDirectory, path.basename(binary.extraction.entryPath)));
	} finally {
		await rm(extractionDirectory, { recursive: true, force: true });
	}
}

function validateBinary(binary: BundledNativeExecutable, bytes: Buffer): void {
	if (bytes.byteLength !== binary.bytes) {
		throw new Error(
			`${binary.executable} size mismatch: expected ${binary.bytes}, got ${bytes.byteLength}`,
		);
	}
	const digest = sha256(bytes);
	if (digest !== binary.sha256) {
		throw new Error(
			`${binary.executable} SHA-256 mismatch: expected ${binary.sha256}, got ${digest}`,
		);
	}
}

async function replaceDirectory(targetDirectory: string, stagedDirectory: string): Promise<void> {
	const backupDirectory = `${targetDirectory}.previous`;
	await rm(backupDirectory, { recursive: true, force: true });
	try {
		await rename(targetDirectory, backupDirectory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	try {
		await rename(stagedDirectory, targetDirectory);
		await rm(backupDirectory, { recursive: true, force: true });
	} catch (error) {
		try {
			await rename(backupDirectory, targetDirectory);
		} catch {
			// Preserve the replacement error when there was no previous stage.
		}
		throw error;
	}
}

/** Stages the proxy and its child together so upstream always finds our pinned runt first. */
export async function stageNteractMcp(
	options: StageNteractMcpOptions,
): Promise<StageNteractMcpResult> {
	const artifact = options.artifact ?? getNteractMcpArtifact();
	const targetDirectory = path.join(options.resourceRoot, artifact.target);
	const nteractMcpPath = path.join(targetDirectory, artifact.nteractMcp.executable);
	const runtPath = path.join(targetDirectory, artifact.runt.executable);
	await mkdir(options.resourceRoot, { recursive: true });
	if (await existingStageIsCurrent(targetDirectory, artifact)) {
		return { artifact, nteractMcpPath, runtPath, staged: false, targetDirectory };
	}

	const stagedDirectory = await mkdtemp(path.join(options.resourceRoot, ".staging-"));
	try {
		const sourceFiles = new Map<string, Promise<string>>();
		const acquire = async (
			binary: BundledNativeExecutable,
			overridePath: string | undefined,
		): Promise<Buffer> => {
			if (overridePath) return readFile(overridePath);
			let sourceFile = sourceFiles.get(binary.source.assetName);
			if (!sourceFile) {
				sourceFile = (async () => {
					const sourceBytes = await downloadSource(binary.source, options);
					const sourcePath = path.join(stagedDirectory, binary.source.assetName);
					await writeFile(sourcePath, sourceBytes);
					return sourcePath;
				})();
				sourceFiles.set(binary.source.assetName, sourceFile);
			}
			const sourcePath = await sourceFile;
			return (options.extract ?? extractBinary)(sourcePath, binary, stagedDirectory);
		};

		const [nteractMcpBytes, runtBytes] = await Promise.all([
			acquire(artifact.nteractMcp, options.sourceNteractMcpPath),
			acquire(artifact.runt, options.sourceRuntPath),
		]);
		validateBinary(artifact.nteractMcp, nteractMcpBytes);
		validateBinary(artifact.runt, runtBytes);

		const stagedNteractMcp = path.join(stagedDirectory, artifact.nteractMcp.executable);
		const stagedRunt = path.join(stagedDirectory, artifact.runt.executable);
		await Promise.all([
			writeFile(stagedNteractMcp, nteractMcpBytes),
			writeFile(stagedRunt, runtBytes),
		]);
		if (artifact.platform !== "win32") {
			await Promise.all([chmod(stagedNteractMcp, 0o755), chmod(stagedRunt, 0o755)]);
		}
		if (!(await isNativeExecutable(stagedNteractMcp, artifact.platform))) {
			throw new Error(`${artifact.nteractMcp.executable} is not a native executable`);
		}
		if (!(await isNativeExecutable(stagedRunt, artifact.platform))) {
			throw new Error(`${artifact.runt.executable} is not a native executable`);
		}
		await writeFile(
			path.join(stagedDirectory, STAGING_MANIFEST),
			`${JSON.stringify(expectedManifest(artifact), null, 2)}\n`,
		);
		for (const source of new Set([
			artifact.nteractMcp.source.assetName,
			artifact.runt.source.assetName,
		])) {
			await rm(path.join(stagedDirectory, source), { force: true });
		}
		await replaceDirectory(targetDirectory, stagedDirectory);
	} finally {
		await rm(stagedDirectory, { recursive: true, force: true });
	}

	return { artifact, nteractMcpPath, runtPath, staged: true, targetDirectory };
}
