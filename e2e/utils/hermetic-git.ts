import { execFileSync } from "node:child_process";

/**
 * Minimal git identity env — mirrors GitHub Desktop's `unit-test-env.ts` and
 * VS Code's `smoke.test.ts` suiteSetup pattern. Passed to every git call the
 * specs make, so fixture repos never depend on the developer's or runner's
 * global gitconfig for author identity or commit signing.
 *
 * `GIT_CONFIG_NOSYSTEM` prevents system-level gitconfig reads (e.g. Homebrew's
 * `/etc/gitconfig`), and the explicit `GIT_CONFIG_COUNT=0` clears any ambient
 * `GIT_CONFIG_KEY_*` chain the CI runner may have injected (GitHub Actions
 * `checkout` sets these for the checkout step but leaves them in the
 * environment for subsequent steps; commit.gpgsign=false is set durably in
 * each repo's local config instead, matching VS Code's smoke-test pattern).
 */
export const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_AUTHOR_NAME: "Git Plugin E2E",
	GIT_AUTHOR_EMAIL: "git-plugin-e2e@example.com",
	GIT_COMMITTER_NAME: "Git Plugin E2E",
	GIT_COMMITTER_EMAIL: "git-plugin-e2e@example.com",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_COUNT: "0",
};

/** Runs git in `directory` with `HERMETIC_GIT_ENV`. */
export function git(directory: string, args: readonly string[]): Buffer {
	return execFileSync("git", ["-C", directory, ...args], { env: HERMETIC_GIT_ENV });
}

/** Sets the identity and disables signing in `directory`'s local config. */
export function configureHermeticIdentity(directory: string): void {
	git(directory, ["config", "user.email", "git-plugin-e2e@example.com"]);
	git(directory, ["config", "user.name", "Git Plugin E2E"]);
	git(directory, ["config", "commit.gpgsign", "false"]);
}
