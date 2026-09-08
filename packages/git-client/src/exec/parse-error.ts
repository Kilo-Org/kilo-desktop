import type { GitErrorCode } from "./errors.js";
import { GitErrorRegexes } from "./errors.js";

/** Try to parse an error type from stderr. */
export const parseError = (stderr: string): GitErrorCode | null =>
	Object.entries(GitErrorRegexes).find(([re]) => stderr.match(re))?.[1] ?? null;
