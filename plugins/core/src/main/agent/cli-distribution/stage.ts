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

import { getKiloCliArtifact, type KiloCliArtifact } from "./artifacts.js";

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
	/** The CLI version now staged: the installed package's, which the lockfile fixes. */
	readonly version: string;
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

async function installedVersion(packageDirectory: string, packageName: string): Promise<string> {
	const installed = JSON.parse(
		await readFile(path.join(packageDirectory, "package.json"), "utf8"),
	) as { version?: unknown };
	if (typeof installed.version !== "string" || !installed.version) {
		throw new Error(`Kilo CLI package ${packageName} has no version. Run pnpm install.`);
	}
	return installed.version;
}

async function stageArtifact(
	stagingDirectory: string,
	manifest: CliDistributionManifest,
	artifact: KiloCliArtifact,
	packageDirectory: string,
): Promise<void> {
	await cp(path.join(packageDirectory, "bin"), path.join(stagingDirectory, "bin"), {
		recursive: true,
	});
	if (artifact.platform !== "win32") {
		await chmod(path.join(stagingDirectory, "bin", artifact.executable), 0o755);
	}
	await writeFile(
		path.join(stagingDirectory, "staged.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
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
	const entries = await readdir(directory, { withFileTypes: true });
	const found = await Promise.all(
		entries.map(async (entry): Promise<string[]> => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return collectExecutables(entryPath);
			return entry.isFile() && entry.name.toLowerCase().endsWith(".exe") ? [entryPath] : [];
		}),
	);
	return found.flat();
}

export async function stageKiloCli(options: StageKiloCliOptions): Promise<StageKiloCliResult> {
	const artifact = options.artifact ?? getKiloCliArtifact();
	const targetDirectory = path.join(options.resourceRoot, artifact.target);
	const packageDirectory =
		options.packageDirectory ?? resolvePackageDirectory(artifact.packageName);
	const manifest: CliDistributionManifest = {
		version: await installedVersion(packageDirectory, artifact.packageName),
		packageName: artifact.packageName,
		target: artifact.target,
	};
	await mkdir(options.resourceRoot, { recursive: true });

	const staged = !(await isCurrent(targetDirectory, manifest, artifact));
	if (staged) {
		const stagedDirectory = await mkdtemp(path.join(options.resourceRoot, ".staging-"));
		try {
			await stageArtifact(stagedDirectory, manifest, artifact, packageDirectory);
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
			// One at a time: each call drives the external code-signing service.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			await options.signExecutable(executable);
		}
	}

	return { artifact, version: manifest.version, staged, targetDirectory };
}
