import { GitErrorCode, GitErrorRegexes } from "./errors.js";

export function parseBadConfigValueErrorInfo(
	stderr: string,
): { key: string; value: string } | null {
	const errorEntry = Object.entries(GitErrorRegexes).find(
		([_, v]) => v === GitErrorCode.BadConfigValue,
	);

	if (errorEntry === undefined) {
		return null;
	}

	const m = stderr.match(errorEntry[0]);

	if (m === null) {
		return null;
	}

	if (!m[1] || !m[2]) {
		return null;
	}

	return { key: m[2], value: m[1] };
}
