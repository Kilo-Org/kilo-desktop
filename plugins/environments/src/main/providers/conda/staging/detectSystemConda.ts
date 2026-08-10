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

async function findCondaOnPath(
	platform: NodeJS.Platform,
	logger: MainSdkLogger,
): Promise<string | null> {
	try {
		const cmd = platform === "win32" ? "where" : "which";
		logger.info(`[conda-detect] Running '${cmd} conda' to search PATH…`);
		const { stdout } = await execa(cmd, ["conda"], { reject: false });
		const resolved = stdout.trim().split("\n")[0]?.trim();
		if (resolved) {
			logger.info(`[conda-detect] PATH search found: ${resolved}`);
			return resolved;
		}
		logger.info("[conda-detect] PATH search returned empty.");
	} catch {
		logger.info("[conda-detect] PATH search command failed or unavailable.");
	}
	return null;
}

async function findCondaInWellKnownPaths(
	platform: NodeJS.Platform,
	logger: MainSdkLogger,
): Promise<string | null> {
	const candidates = wellKnownCondaPaths(platform);
	logger.info(`[conda-detect] Checking ${candidates.length} well-known paths…`);
	for (const candidate of candidates) {
		try {
			await access(candidate, constants.X_OK);
			logger.info(`[conda-detect] Found at well-known path: ${candidate}`);
			return candidate;
		} catch {
			// Not found at this location
		}
	}
	logger.info("[conda-detect] No conda found in well-known paths.");
	return null;
}

async function getCondaVersion(
	condaBinPath: string,
	logger: MainSdkLogger,
): Promise<string | null> {
	try {
		logger.info(`[conda-detect] Running '${condaBinPath} info --json'…`);
		const { stdout } = await execa(condaBinPath, ["info", "--json"], {
			timeout: 10_000,
			reject: false,
		});
		const info = JSON.parse(stdout) as CondaInfoJson;
		if (info.conda_version) {
			logger.info(
				`[conda-detect] Reported version: ${info.conda_version}, root_prefix: ${info.root_prefix ?? "unknown"}`,
			);
		}
		return info.conda_version ?? null;
	} catch (error) {
		logger.info(
			`[conda-detect] 'conda info --json' failed: ${error instanceof Error ? error.message : String(error)}`,
		);
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
	const { logger } = options;

	logger.info("[conda-detect] Starting system conda detection…");

	// Try PATH first
	let condaBinPath = await findCondaOnPath(platform, logger);

	// Fall back to well-known locations
	if (!condaBinPath) {
		condaBinPath = await findCondaInWellKnownPaths(platform, logger);
	}

	if (!condaBinPath) {
		logger.info("[conda-detect] No system conda found.");
		return null;
	}

	const version = await getCondaVersion(condaBinPath, logger);
	if (!version) {
		logger.info("[conda-detect] System conda did not respond to 'conda info --json' — skipping.");
		return null;
	}

	if (!isVersionCompatible(version)) {
		logger.info(
			`[conda-detect] Version ${version} is below minimum ${MIN_CONDA_VERSION.join(".")} — skipping.`,
		);
		return null;
	}

	logger.info(`[conda-detect] ✓ Compatible system conda ${version} at ${condaBinPath}`);
	return { condaBinPath, version };
}
