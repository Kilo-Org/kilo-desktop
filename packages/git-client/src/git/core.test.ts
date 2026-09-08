import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import type { GitClient } from "../client.js";
import {
	getDescriptionForError,
	isAuthFailureError,
	isGitError,
	isMaxBufferExceededError,
} from "./core.js";
import type { GitError } from "./core.js";
import { ExecError, GitErrorCode } from "../exec/errors.js";
import { cleanupTestDirs, createTestDir, initialize, noopLogger } from "../test/util.js";

afterEach(cleanupTestDirs);

/** Error descriptions for each GitErrorCode, matched by exact string or regex. */
const cases: ReadonlyArray<readonly [GitErrorCode, string | null | RegExp]> = [
	[GitErrorCode.SSHAuthenticationFailed, /^Authentication failed\./],
	[GitErrorCode.SSHPermissionDenied, /^Authentication failed\./],
	[GitErrorCode.HTTPSAuthenticationFailed, /^Authentication failed\./],
	[GitErrorCode.BadConfigValue, "Unsupported git configuration value."],
	[
		GitErrorCode.RemoteDisconnection,
		"The remote disconnected. Check your Internet connection and try again.",
	],
	[GitErrorCode.HostDown, "The host is down. Check your Internet connection and try again."],
	[
		GitErrorCode.RebaseConflicts,
		"We found some conflicts while trying to rebase. Please resolve the conflicts before continuing.",
	],
	[
		GitErrorCode.MergeConflicts,
		"We found some conflicts while trying to merge. Please resolve the conflicts and commit the changes.",
	],
	[
		GitErrorCode.HTTPSRepositoryNotFound,
		"The repository does not seem to exist anymore. You may not have access, or it may have been deleted or renamed.",
	],
	[
		GitErrorCode.SSHRepositoryNotFound,
		"The repository does not seem to exist anymore. You may not have access, or it may have been deleted or renamed.",
	],
	[
		GitErrorCode.PushNotFastForward,
		"The repository has been updated since you last pulled. Try pulling before pushing.",
	],
	[
		GitErrorCode.BranchDeletionFailed,
		"Could not delete the branch. It was probably already deleted.",
	],
	[
		GitErrorCode.DefaultBranchDeletionFailed,
		"The branch is the repository's default branch and cannot be deleted.",
	],
	[GitErrorCode.RevertConflicts, "To finish reverting, please merge and commit the changes."],
	[GitErrorCode.EmptyRebasePatch, "There aren’t any changes left to apply."],
	[
		GitErrorCode.NoMatchingRemoteBranch,
		"There aren’t any remote branches that match the current branch.",
	],
	[GitErrorCode.NoExistingRemoteBranch, "The remote branch does not exist."],
	[GitErrorCode.NothingToCommit, "There are no changes to commit."],
	[
		GitErrorCode.NoSubmoduleMapping,
		"A submodule was removed from .gitmodules, but the folder still exists in the repository. Delete the folder, commit the change, then try again.",
	],
	[
		GitErrorCode.SubmoduleRepositoryDoesNotExist,
		"A submodule points to a location which does not exist.",
	],
	[GitErrorCode.InvalidSubmoduleSHA, "A submodule points to a commit which does not exist."],
	[GitErrorCode.LocalPermissionDenied, "Permission denied."],
	[GitErrorCode.InvalidMerge, "This is not something we can merge."],
	[GitErrorCode.InvalidRebase, "This is not something we can rebase."],
	[
		GitErrorCode.NonFastForwardMergeIntoEmptyHead,
		"The merge you attempted is not a fast-forward, so it cannot be performed on an empty branch.",
	],
	[
		GitErrorCode.PatchDoesNotApply,
		"The requested changes conflict with one or more files in the repository.",
	],
	[GitErrorCode.BranchAlreadyExists, "A branch with that name already exists."],
	[GitErrorCode.BadRevision, "Bad revision."],
	[GitErrorCode.NotAGitRepository, "This is not a git repository."],
	[
		GitErrorCode.CannotMergeUnrelatedHistories,
		"Unable to merge unrelated histories in this repository.",
	],
	[
		GitErrorCode.LFSAttributeDoesNotMatch,
		"Git LFS attribute found in global Git configuration does not match expected value.",
	],
	[GitErrorCode.BranchRenameFailed, "The branch could not be renamed."],
	[GitErrorCode.PathDoesNotExist, "The path does not exist on disk."],
	[GitErrorCode.InvalidObjectName, "The object was not found in the Git repository."],
	[GitErrorCode.OutsideRepository, "This path is not a valid path inside the repository."],
	[
		GitErrorCode.LockFileAlreadyExists,
		"A lock file already exists in the repository, which blocks this operation from completing.",
	],
	[GitErrorCode.NoMergeToAbort, "There is no merge in progress, so there is nothing to abort."],
	[
		GitErrorCode.LocalChangesOverwritten,
		"Unable to switch branches as there are working directory changes which would be overwritten. Please commit or stash your changes.",
	],
	[GitErrorCode.UnresolvedConflicts, "There are unresolved conflicts in the working directory."],
	[GitErrorCode.TagAlreadyExists, "A tag with that name already exists"],
	[GitErrorCode.ConfigLockFileAlreadyExists, null],
	[GitErrorCode.RemoteAlreadyExists, null],
	[GitErrorCode.MergeWithLocalChanges, null],
	[GitErrorCode.RebaseWithLocalChanges, null],
	[GitErrorCode.GPGFailedToSignData, null],
	[GitErrorCode.ConflictModifyDeletedInBranch, null],
	[GitErrorCode.MergeCommitNoMainlineOption, null],
	[GitErrorCode.UnsafeDirectory, null],
	[GitErrorCode.PathExistsButNotInRef, null],
];

function createCoreTestClient(path: string): GitClient {
	return createGitClient({ path, logger: noopLogger });
}

describe("git() core", () => {
	it("resolves a successful command with the extended result shape", async () => {
		const path = await initialize("desktop-core-success");
		const git = createCoreTestClient(path);

		const result = await git.exec(["status", "--porcelain"], "status");

		expect(result.exitCode).toBe(0);
		expect(result.gitError).toBeNull();
		expect(result.gitErrorDescription).toBeNull();
		expect(result.path).toBe(path);
	});

	it("keeps TERM dumb for the child process", async () => {
		const path = await createTestDir("desktop-core-term");
		const git = createCoreTestClient(path);

		const result = await git.exec(["-c", "alias.showenv=!echo $TERM", "showenv"], "showenv");

		expect(result.stdout).toBe("dumb\n");
	});

	it("resolves when the exit code is in successExitCodes", async () => {
		const path = await createTestDir("desktop-core-success-exit-codes");
		writeFileSync(join(path, "a.txt"), "a\n");
		writeFileSync(join(path, "b.txt"), "b\n");
		const git = createCoreTestClient(path);

		const result = await git.exec(["diff", "--no-index", "--", "a.txt", "b.txt"], "diff", {
			successExitCodes: new Set([0, 1]),
		});

		expect(result.exitCode).toBe(1);
		expect(result.gitError).toBeNull();
	});

	it("throws GitError for an unparsed unexpected exit code", async () => {
		const path = await initialize("desktop-core-unparsed");
		const git = createCoreTestClient(path);

		const error = await git.exec(["show", "HEAD"], "show").catch((e: unknown) => e);

		expect(isGitError(error)).toBe(true);
		const gitError = error as GitError;
		expect(gitError.isRawMessage).toBe(true);
		expect(gitError.message.startsWith("fatal:")).toBe(true);
		expect(gitError.message).toContain("unknown revision");
		expect(gitError.result.exitCode).toBe(128);
		expect(gitError.args).toEqual(["show", "HEAD"]);
	});

	it("resolves a parsed error listed in expectedErrors", async () => {
		const path = await initialize("desktop-core-expected");
		const git = createCoreTestClient(path);

		const result = await git.exec(["show", ":missing.txt"], "show", {
			expectedErrors: new Set([GitErrorCode.PathDoesNotExist]),
		});

		expect(result.gitError).toBe(GitErrorCode.PathDoesNotExist);
		expect(result.gitErrorDescription).toBe("The path does not exist on disk.");
	});

	it("throws GitError for a parsed error not listed in expectedErrors", async () => {
		const path = await initialize("desktop-core-unexpected-parsed");
		const git = createCoreTestClient(path);

		const error = await git.exec(["show", ":missing.txt"], "show").catch((e: unknown) => e);

		expect(isGitError(error, GitErrorCode.PathDoesNotExist)).toBe(true);
		const gitError = error as GitError;
		expect(gitError.isRawMessage).toBe(false);
		expect(gitError.message).toBe("The path does not exist on disk.");
		expect(gitError.result.path).toBe(path);
	});

	it("falls back to an unknown-error message when the failure produced no output", async () => {
		const path = await initialize("desktop-core-silent-failure");
		const git = createCoreTestClient(path);

		const error = await git.exec(["-c", "alias.x=!false", "x"], "x").catch((e: unknown) => e);

		expect(isGitError(error)).toBe(true);
		const gitError = error as GitError;
		expect(gitError.message).toBe("Unknown error (exit code 1)");
		expect(gitError.isRawMessage).toBe(false);
	});

	it("defaults maxBuffer to the string limit for string encoding", async () => {
		const path = await createTestDir("desktop-core-maxbuffer-default");
		writeFileSync(join(path, "large.txt"), "x".repeat(2 * 1024 * 1024));
		const git = createCoreTestClient(path);

		const result = await git.exec(["diff", "--no-index", "--", "/dev/null", "large.txt"], "diff", {
			successExitCodes: new Set([0, 1]),
		});

		expect(result.stdout.length).toBeGreaterThan(1024 * 1024);
	});

	it("suffixes maxBuffer overflows with the command name and keeps the error code", async () => {
		const path = await createTestDir("desktop-core-maxbuffer-explicit");
		const git = createCoreTestClient(path);

		const error = await git.exec(["-h"], "help", { maxBuffer: 1 }).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExecError);
		expect((error as Error).message.endsWith("for help")).toBe(true);
		expect(isMaxBufferExceededError(error)).toBe(true);
	});

	it("returns buffer output with the buffer encoding", async () => {
		const path = await initialize("desktop-core-buffer");
		const git = createCoreTestClient(path);

		const result = await git.exec(["--version"], "version", { encoding: "buffer" });

		expect(result.stdout).toBeInstanceOf(Buffer);
		expect(result.stdout.toString().includes("git version")).toBe(true);
		expect(result.gitError).toBeNull();
		expect(result.path).toBe(path);
	});

	it("still invokes the caller processCallback and keeps buffered output intact", async () => {
		const path = await createTestDir("desktop-core-process-callback");
		const git = createCoreTestClient(path);

		let callbackFired = false;
		const seenChunks: string[] = [];
		const result = await git.exec(["--version"], "version", {
			processCallback: (subprocess) => {
				callbackFired = true;
				subprocess.stdout?.on("data", (chunk) => {
					seenChunks.push(String(chunk));
				});
			},
		});

		expect(callbackFired).toBe(true);
		expect(seenChunks.join("").includes("git version")).toBe(true);
		expect(result.stdout.includes("git version")).toBe(true);
	});
});

describe("isMaxBufferExceededError", () => {
	it("matches an ExecError with the maxBuffer code", () => {
		const error = new ExecError("boom", "", "", { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
		expect(isMaxBufferExceededError(error)).toBe(true);
	});

	it("rejects other errors", () => {
		expect(isMaxBufferExceededError(new ExecError("boom", "", ""))).toBe(false);
		expect(isMaxBufferExceededError(new Error("boom"))).toBe(false);
		expect(isMaxBufferExceededError(undefined)).toBe(false);
	});
});

describe("isAuthFailureError", () => {
	it("matches the auth failure codes", () => {
		expect(isAuthFailureError(GitErrorCode.SSHAuthenticationFailed)).toBe(true);
		expect(isAuthFailureError(GitErrorCode.SSHPermissionDenied)).toBe(true);
		expect(isAuthFailureError(GitErrorCode.HTTPSAuthenticationFailed)).toBe(true);
	});

	it("rejects non-auth codes", () => {
		expect(isAuthFailureError(GitErrorCode.NotAGitRepository)).toBe(false);
	});
});

describe("getDescriptionForError", () => {
	it("covers every git error code", () => {
		const described = new Set(cases.map(([code]) => code));
		const allCodes = Object.values(GitErrorCode).filter(
			(value): value is GitErrorCode => typeof value === "number",
		);
		expect(allCodes.filter((code) => !described.has(code))).toEqual([]);
	});

	it.each(cases)("describes %s", (code, expected) => {
		const description = getDescriptionForError(code, "");
		if (expected === null) {
			expect(description).toBeNull();
		} else if (expected instanceof RegExp) {
			expect(description ?? "").toMatch(expected);
		} else {
			expect(description).toBe(expected);
		}
	});

	it("returns the auth failure copy for auth failures", () => {
		const description = getDescriptionForError(GitErrorCode.HTTPSAuthenticationFailed, "");
		expect(description).toContain("Authentication failed");
	});

	it("interpolates the config key and value for BadConfigValue", () => {
		const description = getDescriptionForError(
			GitErrorCode.BadConfigValue,
			"fatal: bad boolean config value 'nab' for 'core.autocrlf'",
		);
		expect(description).toBe("Unsupported value 'nab' for git config key 'core.autocrlf'");
	});

	it("falls back when the bad config value cannot be parsed", () => {
		expect(getDescriptionForError(GitErrorCode.BadConfigValue, "unrelated")).toBe(
			"Unsupported git configuration value.",
		);
	});

	it("returns null for errors with no dedicated description", () => {
		expect(getDescriptionForError(GitErrorCode.RemoteAlreadyExists, "")).toBeNull();
	});
});
