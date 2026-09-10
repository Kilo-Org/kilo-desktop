import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type GlobalConfigExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

/**
 * Look up a global config value by name (`git config -z --global <name>`).
 *
 * Resolves `null` when the value isn't configured — git's exit code 1 is an
 * expected outcome, not an error. Reads the global config regardless of the
 * working directory.
 */
export async function getGlobalConfigValue(
	exec: GlobalConfigExec,
	name: string,
): Promise<string | null> {
	const result = await exec(["config", "-z", "--global", name], "getGlobalConfigValue", {
		successExitCodes: new Set([0, 1]),
	});

	// Git exits with 1 if the value isn't found. That's OK.
	if (result.exitCode === 1) {
		return null;
	}

	const pieces = result.stdout.split("\0");
	return pieces[0] ?? null;
}
