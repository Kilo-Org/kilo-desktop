/**
 * Display-name derivation for conda environments.
 *
 * `conda env list --json` reports an empty name for every environment it did
 * not create under an `envs/` directory — base installs, `-p/--prefix` envs,
 * and micromamba trees all come back nameless. Rendering those literally as
 * "base" collapses unrelated environments into a wall of identical rows, so
 * fall back to the prefix's last path segment the way Anaconda Desktop does.
 */

/** Last path segment of a POSIX or Windows path, without trailing separators. */
export function basename(prefix: string): string {
	const trimmed = prefix.replace(/[/\\]+$/, "");
	const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

/**
 * Name to show for an environment: conda's own name when it has one, else the
 * directory the environment lives in. Falls back to "base" only when the
 * prefix yields nothing usable (e.g. a bare "/").
 */
export function environmentDisplayName(env: { name: string; prefix: string }): string {
	if (env.name) return env.name;
	return basename(env.prefix) || "base";
}
