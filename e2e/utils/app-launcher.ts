import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { logger } from "@anaconda/playwright-utils/custom-logger";

import { packagedExecutable, repoRoot } from "./paths.js";

/** Set by global setup; the local Kilo Gateway stub every packaged launch talks to. */
export const KILO_GATEWAY_STUB_URL_ENV = "KILO_E2E_GATEWAY_URL";

/** Per-profile XDG base directories, so each e2e app owns its Kilo CLI state. */
export function profileXdgDirectories(userDataDir: string): {
	data: string;
	cache: string;
	config: string;
	state: string;
} {
	const root = path.join(userDataDir, "xdg");
	return {
		data: path.join(root, "data"),
		cache: path.join(root, "cache"),
		config: path.join(root, "config"),
		state: path.join(root, "state"),
	};
}

/** Where the Kilo CLI of a profile writes its log files (`<XDG_DATA_HOME>/kilo/log`). */
export function profileKiloLogDirectory(userDataDir: string): string {
	return path.join(profileXdgDirectories(userDataDir).data, "kilo", "log");
}

/**
 * Isolated `--user-data-dir` profiles still share the host keychain and would
 * otherwise show first-run onboarding / conda bootstrap. Every packaged e2e
 * launch — including restart fixtures — must use this env.
 *
 * The packaged app forks git processes that inherit this env, so the git
 * config paths are pinned into the worker-unique `userDataDir` and SSH is
 * disabled (`GIT_SSH_COMMAND: "false"` fails fast instead of prompting) —
 * git can never reach the runner's or developer's real gitconfig or agent.
 *
 * The Kilo CLI deliberately inherits XDG data/cache/config so real users share
 * sessions and credentials with the standalone CLI. In e2e that sharing leaked
 * sessions, SQLite databases, and cache locks between workers (and into a
 * developer's real Kilo data), so every profile gets its own XDG directories.
 * Consequently, on Linux the notebook plugin looks for its daemon socket in
 * the profile cache and never attaches to a host daemon.
 *
 * Provider loading must not depend on the public internet: models.dev fetches
 * are disabled (the CLI falls back to its bundled catalog) and, once global
 * setup has started it, the Kilo Gateway base URL points at a local stub.
 *
 * On first start the CLI also npm-installs `@kilocode/plugin` (62 MB) into
 * every config directory that holds plugins, including Desktop's managed
 * `KILO_CONFIG_DIR`, and instance bootstrap — so `/provider` — waits for it.
 * On Windows CI that exceeded the providers page's 15s request bound. Desktop's
 * managed plugins are dependency-free, so npm runs offline against an empty
 * per-profile cache: the install fails in milliseconds and plugins still load.
 *
 * The CLI reads `~/.kilo` / `~/.kilocode` config and rules from its home
 * directory, not XDG; `KILO_TEST_HOME` gives each profile its own. Its log
 * level (shared with Desktop's main-process logger) is DEBUG so the attached
 * `kilo-cli.log` records instance bootstrap steps with timestamps.
 *
 * `HOME`/`USERPROFILE` stay intact: the app resolves `~/` for workspace
 * folder suggestions. These keys win over anything inherited or added to CI
 * later because they are spread after `env`.
 */
export function packagedAppLaunchEnv(
	userDataDir: string,
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const xdg = profileXdgDirectories(userDataDir);
	const gatewayUrl = env[KILO_GATEWAY_STUB_URL_ENV];
	return {
		...Object.fromEntries(
			Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
		KILO_SKIP_ONBOARDING: "1",
		ANACONDA_SKIP_KEYRING: "1",
		GIT_CONFIG_GLOBAL: path.join(userDataDir, ".gitconfig"),
		GIT_CONFIG_SYSTEM: path.join(userDataDir, ".gitconfig-system"),
		SSH_AUTH_SOCK: "",
		GIT_SSH_COMMAND: "false",
		XDG_DATA_HOME: xdg.data,
		XDG_CACHE_HOME: xdg.cache,
		XDG_CONFIG_HOME: xdg.config,
		XDG_STATE_HOME: xdg.state,
		KILO_DISABLE_MODELS_FETCH: "1",
		// Never inherit a gateway URL when setup has not started the stub.
		KILO_API_URL: gatewayUrl || "http://127.0.0.1:1",
		KILO_TEST_HOME: path.join(userDataDir, "kilo-home"),
		KILO_LOG_LEVEL: "DEBUG",
		npm_config_offline: "true",
		npm_config_cache: path.join(userDataDir, "npm-cache"),
	};
}

/**
 * Kill orphaned copies of *this* packaged app left behind by a crashed previous run.
 * Intentionally narrow — never `pkill Electron` (would hit Cursor/Figma/etc.).
 * Kills every instance, so call it only when no worker is running: global
 * setup and teardown. Workers stop their own app by process tree.
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
	const result = spawnSync("pnpm", ["--filter", "@kilo-desktop/desktop", "run", "package:e2e"], {
		cwd: repoRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(`electron-forge package:e2e failed with exit code ${result.status}`);
	}
	logger.info("Packaged Electron app ready.");
}
