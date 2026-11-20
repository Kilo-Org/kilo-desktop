import { KernelError } from "@kilo-desktop/kernel";

/** What a failure message can name: the repository and the server it lives on. */
export type CloneFailureContext = { repository: string; host: string };

/** A known `git` / `gh` stderr shape and the actionable error it maps to. */
export type KnownCloneFailure = {
	pattern: RegExp;
	error: (context: CloneFailureContext) => KernelError;
};

const FAILURE_DETAIL_LINES = 4;

const CLONE_PROGRESS_LINE =
	/^(?:Cloning into|remote: (?:Enumerating|Counting|Compressing|Total)|Receiving objects|Resolving deltas|Updating files|Checking out)/;

/** The tail of git's stderr minus progress chatter, which is where the actual failure is. */
function failureDetail(text: string): string {
	return text
		.split(/\r?\n|\r/)
		.map((line) => line.trim())
		.filter((line) => line && !CLONE_PROGRESS_LINE.test(line))
		.slice(-FAILURE_DETAIL_LINES)
		.join("\n");
}

/** Failures that read the same whichever server the repository is on. */
export const COMMON_CLONE_FAILURES: readonly KnownCloneFailure[] = [
	{
		pattern: /already exists and is not an empty directory/i,
		error: () =>
			new KernelError("VALIDATION", "A folder with that name already exists in this location."),
	},
	{
		pattern: /No space left on device/i,
		error: () =>
			new KernelError("BUSINESS", "There isn't enough disk space to clone this repository."),
	},
	{
		pattern:
			/Could not resolve host|Failed to connect|Connection (?:timed out|refused|reset)|error connecting to|unable to access/i,
		error: ({ host }) =>
			new KernelError(
				"BUSINESS",
				`Couldn't reach ${host}. Check your internet connection, then try again.`,
			),
	},
];

/**
 * Maps a failed clone (or lookup) to the first matching known failure, most
 * specific first. Raw output is only shown when nothing matches.
 */
export function describeCloneFailure(
	stderr: string,
	context: CloneFailureContext,
	known: readonly KnownCloneFailure[],
	fallback: string,
): KernelError {
	const match = known.find(({ pattern }) => pattern.test(stderr));
	if (match) return match.error(context);
	const detail = failureDetail(stderr);
	return new KernelError("BUSINESS", detail ? `${fallback} ${detail}` : fallback);
}
