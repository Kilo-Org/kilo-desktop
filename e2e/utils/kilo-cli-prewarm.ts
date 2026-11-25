import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "@anaconda/playwright-utils/custom-logger";

import { packagedAppLaunchEnv } from "./app-launcher.js";
import { packagedKiloCli } from "./kilo-server-line.js";

const execFileAsync = promisify(execFile);
const PREWARM_TIMEOUT_MS = 180_000;

/**
 * Run the packaged Kilo CLI once before any worker starts.
 *
 * A freshly packaged binary pays one-time costs on its first execution
 * (macOS executable assessment, Windows Defender scanning, runtime
 * extraction). In CI that landed inside a worker's 30s "listening URL"
 * startup window and failed the first Kilo spec of a run. Listing the Kilo
 * provider's models exercises provider initialization against the same
 * hermetic launch env the app uses, in a throwaway profile.
 *
 * Failure is reported but not fatal: specs that need the CLI will fail with
 * their own sidecar diagnostics, and shell-only specs can still run.
 */
export async function prewarmKiloCli(): Promise<void> {
	const cli = packagedKiloCli();
	if (!cli) {
		logger.warn("Kilo CLI pre-warm skipped: no packaged CLI found.");
		return;
	}
	const profile = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-prewarm-"));
	const started = Date.now();
	try {
		await execFileAsync(cli.executable, cli.warmUpArgs, {
			env: packagedAppLaunchEnv(profile),
			timeout: PREWARM_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
		});
		logger.info(`Kilo CLI (${cli.line}) pre-warmed in ${Date.now() - started}ms.`);
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim() ?? "";
		logger.warn(
			`Kilo CLI pre-warm failed after ${Date.now() - started}ms: ${String(error)}${stderr ? `\n${stderr.slice(-4_000)}` : ""}`,
		);
	} finally {
		await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
	}
}
