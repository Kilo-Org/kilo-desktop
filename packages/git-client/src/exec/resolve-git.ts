import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";

import which from "which";

import { GitNotDetectedError } from "./errors.js";

/**
 * Resolve the path to the git executable to invoke.
 *
 * Precedence (preserving compatibility with existing user setups):
 *
 * 1. `gitPath` passed to `createGitClient()` — used as is, no existence check.
 *    A path that resolves but fails to spawn stays an `ExecError` (ENOENT) from
 *    `exec()` — the binary was located, it just failed to run.
 * 2. The `LOCAL_GIT_DIRECTORY` environment variable — a git *installation*
 *    directory; the binary resolves as `<dir>/bin/git` (posix) or
 *    `<dir>/cmd/git.exe` (win32).
 * 3. `which("git")` against the `PATH` from the given environment.
 *
 * Resolution is synchronous so `GitClient.spawn()` can hand back a live
 * process immediately; callers memoize the result. Packaged Electron builds
 * inherit the login-shell PATH via the app bootstrap's shellEnv merge, so
 * system-git discovery works correctly without a separate PATH lookup here.
 *
 * A PATH lookup that lands on the macOS `/usr/bin/git` shim is treated as
 * not detected when the Command Line Tools are missing: every spawn of the
 * shim then fails and re-requests the CLT install dialog. Mirrors VS Code's
 * `findGitDarwin`, including only treating `xcode-select -p` exit 2 as missing.
 */
export function resolveGitBinary(
	gitPath: string | undefined,
	env: Record<string, string | undefined>,
	developerToolsMissing: () => boolean = probeXcodeDeveloperToolsMissing,
): string {
	if (gitPath !== undefined) {
		return gitPath;
	}

	const localGitDir = env["LOCAL_GIT_DIRECTORY"];
	if (localGitDir !== undefined) {
		return resolveGitBinaryFromGitDir(localGitDir);
	}

	const path = env["PATH"];
	const location = which.sync("git", {
		nothrow: true,
		...(path !== undefined && { path }),
	});

	if (location === null) {
		throw new GitNotDetectedError();
	}

	if (
		process.platform === "darwin" &&
		location === MACOS_GIT_SHIM_PATH &&
		developerToolsMissing()
	) {
		throw new GitNotDetectedError();
	}

	return location;
}

const MACOS_GIT_SHIM_PATH = "/usr/bin/git";

function probeXcodeDeveloperToolsMissing(): boolean {
	return spawnSync("xcode-select", ["-p"], { stdio: "ignore" }).status === 2;
}

function resolveGitBinaryFromGitDir(localGitDir: string): string {
	const gitDir = resolve(localGitDir);
	return process.platform === "win32" ? join(gitDir, "cmd", "git.exe") : join(gitDir, "bin", "git");
}
