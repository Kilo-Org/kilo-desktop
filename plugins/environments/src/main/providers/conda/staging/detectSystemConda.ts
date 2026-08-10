import { access, constants } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

/**
 * Minimum conda version required for compatibility.
 * 24.0+ guarantees modern `--json` output, rattler solver support,
 * and the env-var isolation flags the plugin relies on.
 */
const MIN_CONDA_VERSION = [24, 0, 0] as const;

export interface SystemCondaInfo {
	readonly condaBinPath: string;
	readonly version: string;
}

interface CondaInfoJson {
	conda_version?: string;
	root_prefix?: string;
}

function parseVersion(version: string): [number, number, number] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionCompatible(version: string): boolean {
	const parsed = parseVersion(version);
	if (!parsed) return false;
	for (let i = 0; i < 3; i++) {
		if (parsed[i]! > MIN_CONDA_VERSION[i]!) return true;
		if (parsed[i]! < MIN_CONDA_VERSION[i]!) return false;
	}
	return true; // exact match
}

/**
 * Well-known default conda installation paths per platform.
 * Checked when conda is not on PATH.
 */
function wellKnownCondaPaths(platform: NodeJS.Platform): string[] {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	if (platform === "win32") {
		return [
			path.join(home, "miniconda3", "Scripts", "conda.exe"),
			path.join(home, "Miniconda3", "Scripts", "conda.exe"),
			path.join(home, "anaconda3", "Scripts", "conda.exe"),
			path.join(home, "Anaconda3", "Scripts", "conda.exe"),
			"C:\\ProgramData\\miniconda3\\Scripts\\conda.exe",
			"C:\\ProgramData\\Miniconda3\\Scripts\\conda.exe",
			"C:\\ProgramData\\anaconda3\\Scripts\\conda.exe",
			"C:\\ProgramData\\Anaconda3\\Scripts\\conda.exe",
		];
	}
	return [
		path.join(home, "miniconda3", "bin", "conda"),
		path.join(home, "miniforge3", "bin", "conda"),
		path.join(home, "anaconda3", "bin", "conda"),
		path.join(home, "mambaforge", "bin", "conda"),
		"/opt/miniconda3/bin/conda",
		"/opt/anaconda3/bin/conda",
		"/opt/homebrew/bin/conda",
		"/usr/local/bin/conda",
	];
}

async function findCondaOnPath(platform: NodeJS.Platform): Promise<string | null> {
	try {
		const cmd = platform === "win32" ? "where" : "which";
		const { stdout } = await execa(cmd, ["conda"], { reject: false });
		const resolved = stdout.trim().split("\n")[0]?.trim();
		if (resolved) return resolved;
	} catch {
		// `which`/`where` not available or failed
	}
	return null;
}

async function findCondaInWellKnownPaths(platform: NodeJS.Platform): Promise<string | null> {
	for (const candidate of wellKnownCondaPaths(platform)) {
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not found at this location
		}
	}
	return null;
}

async function getCondaVersion(condaBinPath: string): Promise<string | null> {
	try {
		const { stdout } = await execa(condaBinPath, ["info", "--json"], {
			timeout: 10_000,
			reject: false,
		});
		const info = JSON.parse(stdout) as CondaInfoJson;
		return info.conda_version ?? null;
	} catch {
		return null;
	}
}

export interface DetectSystemCondaOptions {
	readonly logger: MainSdkLogger;
	readonly platform?: NodeJS.Platform;
}

/**
 * Attempt to detect a compatible system conda installation.
 *
 * Searches PATH first, then well-known installation directories.
 * Validates that the found binary responds to `conda info --json` and
 * meets the minimum version requirement (>= 24.0.0).
 *
 * Returns the binary path and version if compatible, or `null` if no
 * suitable conda was found. Never throws — detection failure is not fatal.
 */
export async function detectSystemConda(
	options: DetectSystemCondaOptions,
): Promise<SystemCondaInfo | null> {
	const platform = options.platform ?? process.platform;

	// Try PATH first
	let condaBinPath = await findCondaOnPath(platform);

	// Fall back to well-known locations
	if (!condaBinPath) {
		condaBinPath = await findCondaInWellKnownPaths(platform);
	}

	if (!condaBinPath) {
		options.logger.info("No system conda found on PATH or in well-known locations.");
		return null;
	}

	options.logger.info(`Found conda candidate at ${condaBinPath}`);

	const version = await getCondaVersion(condaBinPath);
	if (!version) {
		options.logger.info("System conda did not respond to 'conda info --json' — skipping.");
		return null;
	}

	if (!isVersionCompatible(version)) {
		options.logger.info(
			`System conda version ${version} is below minimum ${MIN_CONDA_VERSION.join(".")} — skipping.`,
		);
		return null;
	}

	options.logger.info(`System conda ${version} at ${condaBinPath} is compatible.`);
	return { condaBinPath, version };
}
