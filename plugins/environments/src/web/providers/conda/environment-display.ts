/**
 * Display-name derivation and validation for conda environments.
 *
 * `conda env list --json` reports an empty name for every environment it did
 * not create under an `envs/` directory — base installs, `-p/--prefix` envs,
 * and micromamba trees all come back nameless. Rendering those literally as
 * "base" collapses unrelated environments into a wall of identical rows, so
 * fall back to the prefix's last path segment.
 */

import { ENVIRONMENT_NAME_PATTERN } from "../../../contracts/providers/conda";

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

/**
 * Validate an environment name against conda's naming rules. Returns an error
 * message string if invalid, or `null` if the name is acceptable. Used by
 * dialog components that accept user-entered environment names.
 */
export function validateEnvironmentName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return "Name is required.";
	if (trimmed.length > 128) return "Name must be 128 characters or fewer.";
	if (!ENVIRONMENT_NAME_PATTERN.test(trimmed)) {
		return "Name must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.";
	}
	return null;
}

/** Names conda keeps for its own root environment. */
const RESERVED_ENVIRONMENT_NAMES = ["base", "root"];

/** Leaves room for a `-<n>` suffix within the 128-character limit. */
const SUGGESTED_NAME_MAX = 120;

/**
 * A name for a new environment made for one package: the package name, or
 * `<name>-2`, `-3`… when an environment already uses it. Names are compared
 * without case, since macOS and Windows folders are case-insensitive.
 */
export function suggestEnvironmentName(
	packageName: string,
	existing: readonly { name: string; prefix: string }[],
): string {
	const base =
		packageName
			.replace(/^[^A-Za-z0-9]+/, "")
			.replace(/[^A-Za-z0-9._-]/g, "-")
			.slice(0, SUGGESTED_NAME_MAX) || "env";
	const taken = new Set(RESERVED_ENVIRONMENT_NAMES);
	for (const env of existing) {
		if (env.name) taken.add(env.name.toLowerCase());
		taken.add(basename(env.prefix).toLowerCase());
	}
	if (!taken.has(base.toLowerCase())) return base;
	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
}
