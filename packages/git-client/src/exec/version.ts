import { coerce, satisfies as semverSatisfies } from "semver";

import { ExecError } from "./errors.js";

const GIT_VERSION_PATTERN = /git version (\d+(?:\.\d+)*)/;

/**
 * Parse a coerced semver version (e.g. "2.39.5") from `git --version` output.
 *
 * `semver.coerce` handles the version formats seen in the wild: plain
 * ("git version 2.53.0"), Git for Windows ("2.53.0.windows.4") and Apple Git
 * ("2.39.5 (Apple Git-154)").
 *
 * Throws `ExecError` when the output cannot be parsed.
 */
export function parseGitVersion(stdout: string): string {
	const match = stdout.match(GIT_VERSION_PATTERN);
	const raw = match?.[1];
	const version = raw === undefined ? null : coerce(raw);

	if (version === null) {
		throw new ExecError(`Could not parse the git version from the output: ${stdout}`, stdout, "");
	}

	return version.version;
}

/** Check a coerced git version against a semver range, e.g. ">=2.23". */
export function satisfies(version: string, range: string): boolean {
	return semverSatisfies(version, range);
}
