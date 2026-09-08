import { kStringMaxLength } from "node:buffer";
import type { Buffer } from "node:buffer";
import { coerceToString } from "./coerce-to-string.js";
import { exec } from "../exec/exec.js";
import type { GitExecutionOptions, GitProcessContext, GitResult } from "../exec/exec.js";
import { ExecError, GitErrorCode } from "../exec/errors.js";
import type { GitLogger } from "../logger.js";
import { parseBadConfigValueErrorInfo } from "../exec/parse-bad-config-value-error-info.js";
import { parseError } from "../exec/parse-error.js";
import { pushTerminalChunk } from "./push-terminal-chunk.js";

export const isMaxBufferExceededError = (
	error: unknown,
): error is ExecError & { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" } => {
	return error instanceof ExecError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
};

/**
 * An extension of the low-level execution options that adds the error-gating
 * knobs of the desktop `git()` layer.
 */
export interface IGitExecutionOptions extends GitExecutionOptions {
	/**
	 * The exit codes which indicate success to the caller. Unexpected exit
	 * codes will be logged and an error thrown. Defaults to 0 if undefined.
	 */
	readonly successExitCodes?: ReadonlySet<number>;

	/**
	 * The git errors which are expected by the caller. Unexpected errors will
	 * be logged and an error thrown.
	 */
	readonly expectedErrors?: ReadonlySet<GitErrorCode>;

	/**
	 * Working directory for this invocation. Defaults to the client's `path`.
	 */
	readonly cwd?: string;
}

export interface IGitStringExecutionOptions extends IGitExecutionOptions {
	readonly encoding?: BufferEncoding;
}

export interface IGitBufferExecutionOptions extends IGitExecutionOptions {
	readonly encoding: "buffer";
}

/**
 * The result of using `git`. This wraps the low-level results to provide the
 * parsed error if one occurs.
 */
export interface IGitResult extends GitResult {
	/**
	 * The parsed git error. This will be null when the exit code is included
	 * in the `successExitCodes`, or when the error could not be parsed.
	 */
	readonly gitError: GitErrorCode | null;

	/** The human-readable error description, based on `gitError`. */
	readonly gitErrorDescription: string | null;

	/**
	 * The path that the Git command was executed from, i.e. the process
	 * working directory (not to be confused with the Git working directory
	 * which is... super confusing, I know)
	 */
	readonly path: string;
}

/** The result of shelling out to git using a string encoding (default) */
export interface IGitStringResult extends IGitResult {
	/** The standard output from git. */
	readonly stdout: string;

	/** The standard error output from git. */
	readonly stderr: string;
}

/** The result of shelling out to git using a buffer encoding */
export interface IGitBufferResult extends IGitResult {
	/** The standard output from git. */
	readonly stdout: Buffer;

	/** The standard error output from git. */
	readonly stderr: Buffer;
}

export class GitError extends Error {
	/** The result from the failed command. */
	public readonly result: IGitResult;

	/** The args for the failed command. */
	public readonly args: ReadonlyArray<string>;

	/**
	 * Whether or not the error message is just the raw output of the git command.
	 */
	public readonly isRawMessage: boolean;

	public constructor(result: IGitResult, args: ReadonlyArray<string>, terminalOutput: string) {
		let rawMessage = true;
		let message: string;

		if (result.gitErrorDescription) {
			message = result.gitErrorDescription;
			rawMessage = false;
		} else if (terminalOutput.length > 0) {
			message = terminalOutput;
		} else if (result.stderr.length) {
			message = coerceToString(result.stderr);
		} else if (result.stdout.length) {
			message = coerceToString(result.stdout);
		} else {
			message = `Unknown error (exit code ${result.exitCode})`;
			rawMessage = false;
		}

		super(message);

		this.name = "GitError";
		this.result = result;
		this.args = args;
		this.isRawMessage = rawMessage;
	}
}

export const isGitError = (e: unknown, parsedError?: GitErrorCode): e is GitError => {
	return e instanceof GitError && (parsedError === undefined || e.result.gitError === parsedError);
};

/**
 * Determine whether the provided `error` is an authentication failure
 * as per our definition. Note that this is not an exhaustive list of
 * authentication failures, only a collection of errors that we treat
 * equally in terms of error message and presentation to the user.
 */
export function isAuthFailureError(
	error: GitErrorCode,
): error is
	| typeof GitErrorCode.SSHAuthenticationFailed
	| typeof GitErrorCode.SSHPermissionDenied
	| typeof GitErrorCode.HTTPSAuthenticationFailed {
	switch (error) {
		case GitErrorCode.SSHAuthenticationFailed:
		case GitErrorCode.SSHPermissionDenied:
		case GitErrorCode.HTTPSAuthenticationFailed:
			return true;
	}
	return false;
}

function assertNever(x: never, message: string): never {
	throw new Error(message);
}

export function getDescriptionForError(error: GitErrorCode, stderr: string): string | null {
	switch (error) {
		case GitErrorCode.SSHAuthenticationFailed:
		case GitErrorCode.SSHPermissionDenied:
		case GitErrorCode.HTTPSAuthenticationFailed:
			return "Authentication failed. You may not have permission to access this repository, or your credentials may have expired.";
		case GitErrorCode.BadConfigValue: {
			const errorInfo = parseBadConfigValueErrorInfo(stderr);
			if (errorInfo === null) {
				return "Unsupported git configuration value.";
			}

			return `Unsupported value '${errorInfo.value}' for git config key '${errorInfo.key}'`;
		}
		case GitErrorCode.RemoteDisconnection:
			return "The remote disconnected. Check your Internet connection and try again.";
		case GitErrorCode.HostDown:
			return "The host is down. Check your Internet connection and try again.";
		case GitErrorCode.RebaseConflicts:
			return "We found some conflicts while trying to rebase. Please resolve the conflicts before continuing.";
		case GitErrorCode.MergeConflicts:
			return "We found some conflicts while trying to merge. Please resolve the conflicts and commit the changes.";
		case GitErrorCode.HTTPSRepositoryNotFound:
		case GitErrorCode.SSHRepositoryNotFound:
			return "The repository does not seem to exist anymore. You may not have access, or it may have been deleted or renamed.";
		case GitErrorCode.PushNotFastForward:
			return "The repository has been updated since you last pulled. Try pulling before pushing.";
		case GitErrorCode.BranchDeletionFailed:
			return "Could not delete the branch. It was probably already deleted.";
		case GitErrorCode.DefaultBranchDeletionFailed:
			return "The branch is the repository's default branch and cannot be deleted.";
		case GitErrorCode.RevertConflicts:
			return "To finish reverting, please merge and commit the changes.";
		case GitErrorCode.EmptyRebasePatch:
			return "There aren’t any changes left to apply.";
		case GitErrorCode.NoMatchingRemoteBranch:
			return "There aren’t any remote branches that match the current branch.";
		case GitErrorCode.NothingToCommit:
			return "There are no changes to commit.";
		case GitErrorCode.NoSubmoduleMapping:
			return "A submodule was removed from .gitmodules, but the folder still exists in the repository. Delete the folder, commit the change, then try again.";
		case GitErrorCode.SubmoduleRepositoryDoesNotExist:
			return "A submodule points to a location which does not exist.";
		case GitErrorCode.InvalidSubmoduleSHA:
			return "A submodule points to a commit which does not exist.";
		case GitErrorCode.LocalPermissionDenied:
			return "Permission denied.";
		case GitErrorCode.InvalidMerge:
			return "This is not something we can merge.";
		case GitErrorCode.InvalidRebase:
			return "This is not something we can rebase.";
		case GitErrorCode.NonFastForwardMergeIntoEmptyHead:
			return "The merge you attempted is not a fast-forward, so it cannot be performed on an empty branch.";
		case GitErrorCode.PatchDoesNotApply:
			return "The requested changes conflict with one or more files in the repository.";
		case GitErrorCode.BranchAlreadyExists:
			return "A branch with that name already exists.";
		case GitErrorCode.BadRevision:
			return "Bad revision.";
		case GitErrorCode.NotAGitRepository:
			return "This is not a git repository.";
		case GitErrorCode.CannotMergeUnrelatedHistories:
			return "Unable to merge unrelated histories in this repository.";
		case GitErrorCode.LFSAttributeDoesNotMatch:
			return "Git LFS attribute found in global Git configuration does not match expected value.";
		case GitErrorCode.BranchRenameFailed:
			return "The branch could not be renamed.";
		case GitErrorCode.PathDoesNotExist:
			return "The path does not exist on disk.";
		case GitErrorCode.InvalidObjectName:
			return "The object was not found in the Git repository.";
		case GitErrorCode.OutsideRepository:
			return "This path is not a valid path inside the repository.";
		case GitErrorCode.LockFileAlreadyExists:
			return "A lock file already exists in the repository, which blocks this operation from completing.";
		case GitErrorCode.NoMergeToAbort:
			return "There is no merge in progress, so there is nothing to abort.";
		case GitErrorCode.NoExistingRemoteBranch:
			return "The remote branch does not exist.";
		case GitErrorCode.LocalChangesOverwritten:
			return "Unable to switch branches as there are working directory changes which would be overwritten. Please commit or stash your changes.";
		case GitErrorCode.UnresolvedConflicts:
			return "There are unresolved conflicts in the working directory.";
		case GitErrorCode.ConfigLockFileAlreadyExists:
			// Not using a custom message yet. Returning a null message here means the stderr will
			// be used as the error message (or stdout if stderr is empty), i.e. the
			// same behavior as before the ConfigLockFileAlreadyExists was added
			return null;
		case GitErrorCode.RemoteAlreadyExists:
			return null;
		case GitErrorCode.TagAlreadyExists:
			return "A tag with that name already exists";
		case GitErrorCode.MergeWithLocalChanges:
		case GitErrorCode.RebaseWithLocalChanges:
		case GitErrorCode.GPGFailedToSignData:
		case GitErrorCode.ConflictModifyDeletedInBranch:
		case GitErrorCode.MergeCommitNoMainlineOption:
		case GitErrorCode.UnsafeDirectory:
		case GitErrorCode.PathExistsButNotInRef:
			return null;
		default:
			return assertNever(error, `Unknown error: ${error}`);
	}
}

/**
 * Shell out to git with the given arguments, at the given path.
 *
 * Returns the result. If the command exits with a code not in
 * `successExitCodes` or an error not in `expectedErrors`, a `GitError` will be
 * thrown.
 */
export async function git(
	args: string[],
	path: string,
	name: string,
	context: GitProcessContext,
	logger: GitLogger,
	options?: IGitStringExecutionOptions,
): Promise<IGitStringResult>;
export async function git(
	args: string[],
	path: string,
	name: string,
	context: GitProcessContext,
	logger: GitLogger,
	options: IGitBufferExecutionOptions,
): Promise<IGitBufferResult>;
export async function git(
	args: string[],
	path: string,
	name: string,
	context: GitProcessContext,
	logger: GitLogger,
	options?: IGitExecutionOptions,
): Promise<IGitResult>;
export async function git(
	args: string[],
	path: string,
	name: string,
	context: GitProcessContext,
	logger: GitLogger,
	options?: IGitExecutionOptions,
): Promise<IGitResult> {
	const defaultOptions: IGitExecutionOptions = {
		successExitCodes: new Set([0]),
		expectedErrors: new Set(),
		maxBuffer: options?.encoding === "buffer" ? Number.POSITIVE_INFINITY : kStringMaxLength,
	};

	const opts = { ...defaultOptions, ...options };

	// The combined contents of stdout and stderr, capped at 256kb. Its sole
	// intent is to provide "terminal-like" output to the user when a Git
	// command fails.
	const terminalChunks: string[] = [];
	const terminalCapacity = 256 * 1024;

	const callerProcessCallback = options?.processCallback;
	opts.processCallback = (subprocess) => {
		const push = (chunk: Buffer | string) => {
			pushTerminalChunk(terminalChunks, terminalCapacity, chunk);
		};

		subprocess.stdout?.on("data", push);
		subprocess.stderr?.on("data", push);

		callerProcessCallback?.(subprocess);
	};

	const result = await exec(args, path, context, opts).catch((err: unknown) => {
		if (isMaxBufferExceededError(err)) {
			throw new ExecError(`${err.message} for ${name}`, err.stdout, err.stderr, err.cause ?? err);
		}

		throw err;
	});

	const exitCode = result.exitCode;

	let gitError: GitErrorCode | null = null;
	const acceptableExitCode = opts.successExitCodes ? opts.successExitCodes.has(exitCode) : false;
	if (!acceptableExitCode) {
		gitError = parseError(coerceToString(result.stderr));
		if (gitError === null) {
			gitError = parseError(coerceToString(result.stdout));
		}
	}

	const gitErrorDescription =
		gitError !== null ? getDescriptionForError(gitError, coerceToString(result.stderr)) : null;
	const gitResult = {
		...result,
		gitError,
		gitErrorDescription,
		path,
	};

	let acceptableError = true;
	if (gitError !== null && opts.expectedErrors) {
		acceptableError = opts.expectedErrors.has(gitError);
	}

	if ((gitError !== null && acceptableError) || acceptableExitCode) {
		return gitResult;
	}

	// The caller should either handle this error, or expect that exit code.
	const errorMessage = new Array<string>();
	errorMessage.push(`\`git ${args.join(" ")}\` exited with an unexpected code: ${exitCode}.`);

	const terminalOutput = terminalChunks.join("");

	if (terminalOutput.length > 0) {
		// Leave even less of the combined output in the log
		errorMessage.push(terminalOutput.slice(-1024));
	}

	if (gitError !== null) {
		errorMessage.push(`(The error was parsed as ${gitError}: ${gitErrorDescription})`);
	}

	logger.error(errorMessage.join("\n"));

	throw new GitError(gitResult, args, terminalOutput);
}
