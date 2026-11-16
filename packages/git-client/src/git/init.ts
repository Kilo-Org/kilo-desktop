import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";
import { getGlobalConfigValue } from "./config.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type InitExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface InitOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/**
 * Initialize the directory as a git repository with
 * `git -c init.defaultBranch=<branch> init`. The branch is the global
 * `init.defaultBranch` config value, falling back to `main`; it is passed
 * via `-c` and never written to any config. Idempotent: running against an
 * existing repository reinitializes harmlessly without touching HEAD.
 */
export async function initRepository(exec: InitExec, options?: InitOptions): Promise<void> {
	const defaultBranch = (await getGlobalConfigValue(exec, "init.defaultBranch")) ?? "main";

	await exec(["-c", `init.defaultBranch=${defaultBranch}`, "init"], "initRepository", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}
