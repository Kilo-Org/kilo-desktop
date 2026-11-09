/**
 * Logger sink for git execution failures. Injected via
 * `GitClientOptions.logger`; hosts running under Electron can pass
 * `log.scope("git")`, which satisfies this interface structurally.
 */
export interface GitLogger {
	error(...args: unknown[]): void;
}

export function createGitLogger(): GitLogger {
	return { error: (...args: unknown[]) => console.error(...args) };
}
