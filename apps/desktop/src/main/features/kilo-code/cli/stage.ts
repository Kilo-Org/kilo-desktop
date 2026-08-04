import { execFile as execFileCallback } from "node:child_process";
import {
	access,
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getKiloCliArtifact, KILO_CLI_VERSION, type KiloCliArtifact } from "./artifacts.js";

const execFile = promisify(execFileCallback);

interface StagedManifest {
	readonly version: string;
	readonly packageName: string;
	readonly integrity: string;
	readonly target: string;
}

export interface StageKiloCliOptions {
	readonly resourceRoot: string;
	readonly artifact?: KiloCliArtifact;
	readonly signExecutable?: (executablePath: string) => Promise<void>;
}

export interface StageKiloCliResult {
	readonly artifact: KiloCliArtifact;
	readonly staged: boolean;
	readonly targetDirectory: string;
}

async function isCurrent(
	targetDirectory: string,
	expected: StagedManifest,
	artifact: KiloCliArtifact,
): Promise<boolean> {
	try {
		const manifest = JSON.parse(
			await readFile(path.join(targetDirectory, "staged.json"), "utf8"),
		) as StagedManifest;
		await access(path.join(targetDirectory, "bin", artifact.executable));
		await access(path.join(targetDirectory, "bin", "tree-sitter"));
		return (
			manifest.version === expected.version &&
			manifest.packageName === expected.packageName &&
			manifest.integrity === expected.integrity &&
			manifest.target === expected.target
		);
	} catch {
		return false;
	}
}

async function installArtifact(stagingDirectory: string, artifact: KiloCliArtifact): Promise<void> {
	const installDirectory = await mkdtemp(path.join(os.tmpdir(), "anaconda-kilo-install-"));
	try {
		await writeFile(
			path.join(installDirectory, "package.json"),
			`${JSON.stringify(
				{
					private: true,
					dependencies: { [artifact.packageName]: KILO_CLI_VERSION },
				},
				null,
				2,
			)}\n`,
		);
		await execFile(
			process.platform === "win32" ? "npm.cmd" : "npm",
			[
				"install",
				"--ignore-scripts",
				"--package-lock=true",
				"--fund=false",
				"--audit=false",
				`--os=${artifact.platform}`,
				`--cpu=${artifact.arch}`,
			],
			{ cwd: installDirectory, maxBuffer: 10 * 1024 * 1024 },
		);

		const packageLock = JSON.parse(
			await readFile(path.join(installDirectory, "package-lock.json"), "utf8"),
		) as { packages?: Record<string, { integrity?: string; version?: string }> };
		const installed = packageLock.packages?.[`node_modules/${artifact.packageName}`];
		if (installed?.version !== KILO_CLI_VERSION) {
			throw new Error(
				`Kilo CLI version mismatch: expected ${KILO_CLI_VERSION}, got ${installed?.version ?? "unknown"}.`,
			);
		}
		if (installed.integrity !== artifact.integrity) {
			throw new Error(
				`Kilo CLI integrity mismatch for ${artifact.packageName}: expected ${artifact.integrity}, got ${installed.integrity ?? "missing"}.`,
			);
		}

		await cp(
			path.join(installDirectory, "node_modules", artifact.packageName, "bin"),
			path.join(stagingDirectory, "bin"),
			{ recursive: true },
		);
		if (artifact.platform !== "win32") {
			await chmod(path.join(stagingDirectory, "bin", artifact.executable), 0o755);
		}
		await writeFile(
			path.join(stagingDirectory, "staged.json"),
			`${JSON.stringify(
				{
					version: KILO_CLI_VERSION,
					packageName: artifact.packageName,
					integrity: artifact.integrity,
					target: artifact.target,
				} satisfies StagedManifest,
				null,
				2,
			)}\n`,
		);
	} finally {
		await rm(installDirectory, { recursive: true, force: true });
	}
}

async function replaceStaging(targetDirectory: string, stagedDirectory: string): Promise<void> {
	const backupDirectory = `${targetDirectory}.previous`;
	await rm(backupDirectory, { recursive: true, force: true });
	try {
		await rename(targetDirectory, backupDirectory);
	} catch {
		// The first staging run has nothing to back up.
	}
	try {
		await rename(stagedDirectory, targetDirectory);
		await rm(backupDirectory, { recursive: true, force: true });
	} catch (error) {
		try {
			await rename(backupDirectory, targetDirectory);
		} catch {
			// Preserve the original failure when no backup existed.
		}
		throw error;
	}
}

async function collectExecutables(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await collectExecutables(entryPath)));
		else if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) result.push(entryPath);
	}
	return result;
}

export async function stageKiloCli(options: StageKiloCliOptions): Promise<StageKiloCliResult> {
	const artifact = options.artifact ?? getKiloCliArtifact();
	const targetDirectory = path.join(options.resourceRoot, artifact.target);
	const manifest: StagedManifest = {
		version: KILO_CLI_VERSION,
		packageName: artifact.packageName,
		integrity: artifact.integrity,
		target: artifact.target,
	};
	await mkdir(options.resourceRoot, { recursive: true });

	const staged = !(await isCurrent(targetDirectory, manifest, artifact));
	if (staged) {
		const stagedDirectory = await mkdtemp(path.join(options.resourceRoot, ".staging-"));
		try {
			await installArtifact(stagedDirectory, artifact);
			await replaceStaging(targetDirectory, stagedDirectory);
		} finally {
			await rm(stagedDirectory, { recursive: true, force: true });
		}
	}

	if (artifact.platform === "win32" && options.signExecutable) {
		for (const executable of await collectExecutables(path.join(targetDirectory, "bin"))) {
			await options.signExecutable(executable);
		}
	}

	return { artifact, staged, targetDirectory };
}
