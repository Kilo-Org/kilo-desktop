import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	open,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

import { NTERACT_RELEASE, type NativeReleaseArtifact } from "./artifacts.js";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const STAGING_MANIFEST = "staged.json";

interface StagingManifest {
	readonly schemaVersion: 1;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly target: string;
	readonly assetName: string;
	readonly bytes: number;
	readonly sha256: string;
}

export interface StagePinnedBinaryOptions {
	readonly resourceRoot: string;
	readonly artifact: NativeReleaseArtifact;
	readonly downloadUrl: string;
	readonly label: string;
	readonly sourceBinaryPath?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export interface StagePinnedBinaryResult {
	readonly artifact: NativeReleaseArtifact;
	readonly executablePath: string;
	readonly staged: boolean;
	readonly targetDirectory: string;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function expectedManifest(artifact: NativeReleaseArtifact): StagingManifest {
	return {
		schemaVersion: 1,
		releaseTag: NTERACT_RELEASE.tag,
		sourceCommit: NTERACT_RELEASE.commit,
		target: artifact.target,
		assetName: artifact.assetName,
		bytes: artifact.bytes,
		sha256: artifact.sha256,
	};
}

async function existingStageIsCurrent(
	targetDirectory: string,
	artifact: NativeReleaseArtifact,
): Promise<boolean> {
	try {
		const executablePath = path.join(targetDirectory, artifact.executable);
		const manifest = JSON.parse(
			await readFile(path.join(targetDirectory, STAGING_MANIFEST), "utf8"),
		) as StagingManifest;
		const executable = await readFile(executablePath);
		const executableInfo = await stat(executablePath);
		const expected = expectedManifest(artifact);
		return (
			executableInfo.isFile() &&
			(artifact.platform === "win32" || (executableInfo.mode & 0o111) !== 0) &&
			(await isNativeExecutable(executablePath, artifact.platform)) &&
			manifest.schemaVersion === expected.schemaVersion &&
			manifest.releaseTag === expected.releaseTag &&
			manifest.sourceCommit === expected.sourceCommit &&
			manifest.target === expected.target &&
			manifest.assetName === expected.assetName &&
			manifest.bytes === expected.bytes &&
			manifest.sha256 === expected.sha256 &&
			executable.byteLength === artifact.bytes &&
			sha256(executable) === artifact.sha256
		);
	} catch {
		return false;
	}
}

export async function isNativeExecutable(
	filePath: string,
	platform: NodeJS.Platform,
): Promise<boolean> {
	const file = await open(filePath, "r");
	try {
		const magic = Buffer.alloc(4);
		const { bytesRead } = await file.read(magic, 0, magic.length, 0);
		if (bytesRead !== magic.length) return false;
		if (platform === "win32") return magic[0] === 0x4d && magic[1] === 0x5a;
		if (platform === "linux") return magic.readUInt32BE(0) === 0x7f454c46;
		const word = magic.readUInt32BE(0);
		return [0xfeedfacf, 0xfeedface, 0xcffaedfe, 0xcefaedfe, 0xcafebabe].includes(word);
	} finally {
		await file.close();
	}
}

async function acquireBinary(
	options: StagePinnedBinaryOptions,
	artifact: NativeReleaseArtifact,
): Promise<Buffer> {
	if (options.sourceBinaryPath) return readFile(options.sourceBinaryPath);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
	try {
		const response = await (options.fetch ?? fetch)(options.downloadUrl, {
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`could not download ${artifact.assetName}: HTTP ${response.status}`);
		}
		return Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timer);
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

export async function stagePinnedBinary(
	options: StagePinnedBinaryOptions,
): Promise<StagePinnedBinaryResult> {
	const { artifact, label } = options;
	const targetDirectory = path.join(options.resourceRoot, artifact.target);
	const executablePath = path.join(targetDirectory, artifact.executable);
	await mkdir(options.resourceRoot, { recursive: true });
	if (await existingStageIsCurrent(targetDirectory, artifact)) {
		return { artifact, executablePath, staged: false, targetDirectory };
	}

	const bytes = await acquireBinary(options, artifact);
	if (bytes.byteLength !== artifact.bytes) {
		throw new Error(
			`${label} size mismatch for ${artifact.assetName}: expected ${artifact.bytes}, got ${bytes.byteLength}`,
		);
	}
	const digest = sha256(bytes);
	if (digest !== artifact.sha256) {
		throw new Error(
			`${label} SHA-256 mismatch for ${artifact.assetName}: expected ${artifact.sha256}, got ${digest}`,
		);
	}

	const stagedDirectory = await mkdtemp(path.join(options.resourceRoot, ".staging-"));
	try {
		const stagedExecutable = path.join(stagedDirectory, artifact.executable);
		await writeFile(stagedExecutable, bytes);
		if (!(await isNativeExecutable(stagedExecutable, artifact.platform))) {
			throw new Error(`${artifact.assetName} is not a native ${artifact.platform} executable`);
		}
		if (artifact.platform !== "win32") await chmod(stagedExecutable, 0o755);
		await writeFile(
			path.join(stagedDirectory, STAGING_MANIFEST),
			`${JSON.stringify(expectedManifest(artifact), null, 2)}\n`,
		);
		await replaceDirectory(targetDirectory, stagedDirectory);
	} finally {
		await rm(stagedDirectory, { recursive: true, force: true });
	}

	const info = await stat(executablePath);
	if (!info.isFile()) throw new Error(`staged ${label} is not a file: ${executablePath}`);
	return { artifact, executablePath, staged: true, targetDirectory };
}
