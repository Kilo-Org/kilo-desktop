import { execFile } from "node:child_process";

/**
 * Compares the daemon we bundle against the one actually listening.
 *
 * This matters because we attach to whatever daemon already holds the singleton
 * lock, which may be a user-installed nteract of the same channel built at a
 * different commit. Typed-frame v4 fails closed with no downgrade path, so a
 * commit skew surfaces as corrupt traffic rather than a negotiation failure —
 * the check has to happen before we hand the relay a connection.
 *
 * Commit hash, not semver: CI appends `+{git_sha}` at build time, and two
 * builds of the same `X.Y.Z` from different commits are not interchangeable.
 */

const VERSION_TIMEOUT_MS = 5_000;

/**
 * Pulls the SHA out of `X.Y.Z+SHA[+dirty]`. The `+dirty` suffix is dropped on
 * purpose: it says the tree had uncommitted edits, not that the commit differs,
 * and treating it as a mismatch would reject every local rebuild.
 */
export function extractCommitHash(version: string): string | undefined {
	return version.split("+")[1]?.trim() || undefined;
}

export type VersionVerdict = "match" | "mismatch" | "unknown";

/**
 * `unknown` when either side carries no commit hash — a locally built daemon
 * with no CI-stamped SHA, for instance. Unknown must not block: refusing to run
 * against a daemon we cannot identify would break development, where the two
 * are usually the same build anyway.
 */
export function compareDaemonVersions(
	running: string | undefined,
	bundled: string | undefined,
): VersionVerdict {
	if (!running || !bundled) return "unknown";
	const runningCommit = extractCommitHash(running);
	const bundledCommit = extractCommitHash(bundled);
	if (!runningCommit || !bundledCommit) return "unknown";
	return runningCommit === bundledCommit ? "match" : "mismatch";
}

/** Strips the program name from `runtimed 2.6.3+22d094c`. */
export function parseVersionOutput(stdout: string): string | undefined {
	return stdout.trim().split(/\s+/).at(-1) || undefined;
}

/**
 * Asks the staged binary its own version. There is no manifest to read instead:
 * the version is compiled into the executable, and the staged asset's filename
 * records only its channel.
 */
export function readBundledDaemonVersion(
	binaryPath: string,
	timeoutMs = VERSION_TIMEOUT_MS,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(binaryPath, ["--version"], { timeout: timeoutMs }, (error, stdout) => {
			resolve(error ? undefined : parseVersionOutput(stdout));
		});
	});
}
