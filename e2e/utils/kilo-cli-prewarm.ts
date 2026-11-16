import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "@anaconda/playwright-utils/custom-logger";

import { packagedAppLaunchEnv } from "./app-launcher.js";
import { packagedResourcesDirectory } from "./paths.js";

const execFileAsync = promisify(execFile);
const PREWARM_TIMEOUT_MS = 180_000;

/**
 * The packaged CLI lives at `<Resources>/kilo/<target>/bin/kilo[.exe]`.
 *
 * Packaging copies the whole staging root, which can also hold an interrupted
 * `.staging-*` directory or a `<target>.previous` backup with the same
 * layout. Only a completed staging sits in the directory named after the
 * `target` recorded in its own `staged.json`, so that is the one the app runs.
 */
export function packagedKiloCliExecutable(): string | undefined {
	const kiloRoot = path.join(packagedResourcesDirectory(), "kilo");
	if (!existsSync(kiloRoot)) return undefined;
	const executable = process.platform === "win32" ? "kilo.exe" : "kilo";
	for (const directory of readdirSync(kiloRoot)) {
		const candidate = path.join(kiloRoot, directory, "bin", executable);
		if (stagedTarget(path.join(kiloRoot, directory)) === directory && existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function stagedTarget(stagingDirectory: string): string | undefined {
	try {
		const manifest = JSON.parse(
			readFileSync(path.join(stagingDirectory, "staged.json"), "utf8"),
		) as { target?: unknown };
		return typeof manifest.target === "string" ? manifest.target : undefined;
	} catch {
		return undefined;
	}
}

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
	const executable = packagedKiloCliExecutable();
	if (!executable) {
		logger.warn("Kilo CLI pre-warm skipped: no packaged CLI found.");
		return;
	}
	const profile = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-prewarm-"));
	const started = Date.now();
	try {
		await execFileAsync(executable, ["models", "kilo"], {
			env: packagedAppLaunchEnv(profile),
			timeout: PREWARM_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
		});
		logger.info(`Kilo CLI pre-warmed in ${Date.now() - started}ms.`);
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim() ?? "";
		logger.warn(
			`Kilo CLI pre-warm failed after ${Date.now() - started}ms: ${String(error)}${stderr ? `\n${stderr.slice(-4_000)}` : ""}`,
		);
	} finally {
		await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
	}
}
