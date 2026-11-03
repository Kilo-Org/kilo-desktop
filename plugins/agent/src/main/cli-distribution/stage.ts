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
import { createRequire } from "node:module";
import path from "node:path";

import { getKiloCliArtifact, KILO_CLI_VERSION, type KiloCliArtifact } from "./artifacts.js";

interface CliDistributionManifest {
	readonly version: string;
	readonly packageName: string;
	readonly target: string;
}

export interface StageKiloCliOptions {
	readonly resourceRoot: string;
	readonly artifact?: KiloCliArtifact;
	readonly packageDirectory?: string;
	readonly signExecutable?: (executablePath: string) => Promise<void>;
}

export interface StageKiloCliResult {
	readonly artifact: KiloCliArtifact;
	readonly staged: boolean;
	readonly targetDirectory: string;
}

async function isCurrent(
	targetDirectory: string,
	expected: CliDistributionManifest,
	artifact: KiloCliArtifact,
): Promise<boolean> {
	try {
		const manifest = JSON.parse(
			await readFile(path.join(targetDirectory, "staged.json"), "utf8"),
		) as CliDistributionManifest;
		await access(path.join(targetDirectory, "bin", artifact.executable));
		await access(path.join(targetDirectory, "bin", "tree-sitter"));
		return (
			manifest.version === expected.version &&
			manifest.packageName === expected.packageName &&
			manifest.target === expected.target
		);
	} catch {
		return false;
	}
}

function resolvePackageDirectory(packageName: string): string {
	const require = createRequire(import.meta.url);
	try {
		return path.dirname(require.resolve(`${packageName}/package.json`));
	} catch (error) {
		throw new Error(
			`Kilo CLI package ${packageName} is not installed for this platform. Run pnpm install.`,
			{ cause: error },
		);
	}
}

async function stageArtifact(
	stagingDirectory: string,
	artifact: KiloCliArtifact,
	packageDirectory: string,
): Promise<void> {
	const installed = JSON.parse(
		await readFile(path.join(packageDirectory, "package.json"), "utf8"),
	) as {
		version?: string;
	};
	if (installed.version !== KILO_CLI_VERSION) {
		throw new Error(
			`Kilo CLI version mismatch: expected ${KILO_CLI_VERSION}, got ${installed.version ?? "unknown"}.`,
		);
	}

	await cp(path.join(packageDirectory, "bin"), path.join(stagingDirectory, "bin"), {
		recursive: true,
	});
	if (artifact.platform !== "win32") {
		await chmod(path.join(stagingDirectory, "bin", artifact.executable), 0o755);
	}
	await writeFile(
		path.join(stagingDirectory, "staged.json"),
		`${JSON.stringify(
			{
				version: KILO_CLI_VERSION,
				packageName: artifact.packageName,
				target: artifact.target,
			} satisfies CliDistributionManifest,
			null,
			2,
		)}\n`,
	);
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
	const manifest: CliDistributionManifest = {
		version: KILO_CLI_VERSION,
		packageName: artifact.packageName,
		target: artifact.target,
	};
	await mkdir(options.resourceRoot, { recursive: true });

	const staged = !(await isCurrent(targetDirectory, manifest, artifact));
	if (staged) {
		const stagedDirectory = await mkdtemp(path.join(options.resourceRoot, ".staging-"));
		try {
			await stageArtifact(
				stagedDirectory,
				artifact,
				options.packageDirectory ?? resolvePackageDirectory(artifact.packageName),
			);
			await replaceStaging(targetDirectory, stagedDirectory);
		} finally {
			await rm(stagedDirectory, { recursive: true, force: true });
		}
	}
	// mkdtemp creates the staging directory owner-only (0700) and the rename
	// keeps that mode. Linux .deb installs resources as root, so an owner-only
	// directory hides the CLI from the user running the app. Normalize on every
	// run so stages restored from a CI cache are repaired too.
	if (process.platform !== "win32") await chmod(targetDirectory, 0o755);

	if (artifact.platform === "win32" && options.signExecutable) {
		for (const executable of await collectExecutables(path.join(targetDirectory, "bin"))) {
			await options.signExecutable(executable);
		}
	}

	return { artifact, staged, targetDirectory };
}
