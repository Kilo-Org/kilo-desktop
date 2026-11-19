import path from "node:path";

import { KernelError } from "@kilo-desktop/kernel";
import {
	GitNotDetectedError,
	isGitError,
	UnsupportedGitVersionError,
	type GitClient,
} from "@kilo-desktop/git-client";

import { unsupportedGitVersionToKernelError } from "../repository/unsupported-git-version";
import { GIT_NOT_FOUND_MESSAGE } from "../repository/worktree-manager";
import {
	COMMON_CLONE_FAILURES,
	describeCloneFailure,
	type KnownCloneFailure,
} from "./clone-failures";

/** Large repositories take a while; the user waits on an explicit "Cloning…" state. */
const CLONE_TIMEOUT_MS = 30 * 60_000;

const URL_FORM = /^(?:https?|ssh|git):\/\/[^\s/]+\/\S+$/i;
/** scp-like SSH form, e.g. `git@gitlab.com:group/project.git`. */
const SCP_FORM = /^[\w.-]+@[\w.-]+:[^\s/]\S*$/;

/**
 * Accepts the remote forms people paste (https, ssh, git and scp-like SSH)
 * and returns the trimmed URL, or null for anything else. Local paths and
 * anything that could be read as a git flag are rejected.
 */
export function parseGitUrl(input: string): string | null {
	const url = input.trim();
	return URL_FORM.test(url) || SCP_FORM.test(url) ? url : null;
}

/** The server a clone URL points at, for error messages. */
function hostOf(url: string): string {
	return (
		url.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i)?.[1] ??
		url.match(/@([^:]+):/)?.[1] ??
		"the server"
	);
}

const GIT_URL_FAILURES: readonly KnownCloneFailure[] = [
	{
		pattern:
			/Repository not found|repository '.*' not found|does not appear to be a git repository|HTTP 404|returned error: 404/i,
		error: ({ repository }) =>
			new KernelError(
				"NOT_FOUND",
				`Couldn't find a Git repository at ${repository}. Check the URL, or make sure you have access to it.`,
			),
	},
	{
		pattern: /Permission denied \(publickey\)|Host key verification failed/i,
		error: ({ host }) =>
			new KernelError(
				"BUSINESS",
				`Git couldn't sign in to ${host} over SSH. Make sure your SSH key is added there, or use an HTTPS URL.`,
			),
	},
	{
		pattern:
			/Authentication failed|could not read Username|terminal prompts disabled|HTTP 401|returned error: 40[13]/i,
		error: ({ host }) =>
			new KernelError(
				"BUSINESS",
				`${host} asked for a sign-in, so the repository is private or the URL is wrong. Check the URL, or set up a Git credential helper for ${host}, then try again.`,
			),
	},
	...COMMON_CLONE_FAILURES,
];

/**
 * Clones any Git remote into `destination` (which must not exist yet) with
 * plain `git clone`, using the user's own credential helper or SSH keys.
 * Prompts are disabled so a missing credential fails instead of hanging on
 * a terminal nobody can see; git removes `destination` itself on failure.
 */
export async function cloneGitUrl(
	client: Pick<GitClient, "exec">,
	input: { url: string; destination: string },
): Promise<void> {
	const url = parseGitUrl(input.url);
	if (!url) {
		throw new KernelError(
			"VALIDATION",
			"Enter a Git URL such as https://host/owner/repo.git or git@host:owner/repo.git.",
		);
	}
	try {
		await client.exec(["clone", "--", url, input.destination], "clone", {
			cwd: path.dirname(input.destination),
			env: { GIT_TERMINAL_PROMPT: "0" },
			signal: AbortSignal.timeout(CLONE_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof GitNotDetectedError) {
			throw new KernelError("BUSINESS", GIT_NOT_FOUND_MESSAGE);
		}
		if (error instanceof UnsupportedGitVersionError) {
			throw unsupportedGitVersionToKernelError(error);
		}
		if (isGitError(error)) {
			throw describeCloneFailure(
				String(error.result.stderr ?? ""),
				{ repository: url, host: hostOf(url) },
				GIT_URL_FAILURES,
				"The repository could not be cloned.",
			);
		}
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new KernelError("BUSINESS", "Cloning took too long and was stopped.");
		}
		throw error;
	}
}
