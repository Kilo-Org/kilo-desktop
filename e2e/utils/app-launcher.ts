import { execFileSync, spawnSync } from "node:child_process";

import { logger } from "@anaconda/playwright-utils";

import { packagedExecutable, repoRoot } from "./paths.js";

/**
 * Kill orphaned copies of *this* packaged app left behind by a crashed previous run.
 * Intentionally narrow — never `pkill Electron` (would hit Cursor/Figma/etc.).
 */
export function killStrayProcesses(): void {
	const executable = packagedExecutable();
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/F", "/IM", "anaconda-agentic-desktop.exe", "/T"], {
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
