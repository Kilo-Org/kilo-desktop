import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { logger } from "@anaconda/playwright-utils/custom-logger";

import { packagedExecutable, repoRoot } from "./paths.js";

/**
 * Isolated `--user-data-dir` profiles still share the host keychain and would
 * otherwise show first-run onboarding / conda bootstrap. Every packaged e2e
 * launch — including restart fixtures — must use this env.
 */
export function packagedAppLaunchEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	return {
		...Object.fromEntries(
			Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
		ANACONDA_SKIP_CONDA_STAGING: "1",
		ANACONDA_SKIP_ONBOARDING: "1",
		ANACONDA_SKIP_KEYRING: "1",
	};
}

/**
 * Kill orphaned copies of *this* packaged app left behind by a crashed previous run.
 * Intentionally narrow — never `pkill Electron` (would hit Cursor/Figma/etc.).
 */
export function killStrayProcesses(): void {
	const executable = packagedExecutable();
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/F", "/IM", path.basename(executable), "/T"], {
				stdio: "ignore",
			});
		} catch {
			// Process not found — expected.
		}
		return;
	}

	try {
		execFileSync("pkill", ["-f", executable], { stdio: "ignore" });
	} catch {
		// Process not found — expected.
	}
}

export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
		} catch {
			// Process not found — expected.
		}
		return;
	}

	try {
		execFileSync("pkill", ["-P", String(pid)], { stdio: "ignore" });
	} catch {
		// No children — expected.
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Process not found — expected.
	}
}

/** Package the Electron app for Playwright (inspect fuse enabled). */
export async function buildPackagedApp(): Promise<void> {
	logger.info("Building packaged Electron app for e2e…");
	const result = spawnSync(
		"pnpm",
		["--filter", "@anaconda-agentic-desktop/desktop", "run", "package:e2e"],
		{
			cwd: repoRoot,
			stdio: "inherit",
			shell: process.platform === "win32",
			env: process.env,
		},
	);
	if (result.status !== 0) {
		throw new Error(`electron-forge package:e2e failed with exit code ${result.status}`);
	}
	logger.info("Packaged Electron app ready.");
}
