import { describe, expect, it } from "vitest";

import { GitErrorCode, GitErrorRegexes } from "./errors.js";
import { parseBadConfigValueErrorInfo } from "./parse-bad-config-value-error-info.js";
import { parseError } from "./parse-error.js";

describe("parseError", () => {
	const cases = [
		[
			"HTTPS auth errors",
			"fatal: Authentication failed for 'https://www.github.com/shiftkey/desktop.git/'",
			GitErrorCode.HTTPSAuthenticationFailed,
		],
		[
			"HTTP auth errors",
			"fatal: Authentication failed for 'http://localhost:3000'",
			GitErrorCode.HTTPSAuthenticationFailed,
		],
		["SSH auth errors", "fatal: Authentication failed", GitErrorCode.SSHAuthenticationFailed],
		["bad revision errors", "fatal: bad revision 'beta..origin/beta'", GitErrorCode.BadRevision],
		[
			"unrelated histories error",
			"fatal: refusing to merge unrelated histories",
			GitErrorCode.CannotMergeUnrelatedHistories,
		],
		[
			"LFS attribute does not match error",
			`The filter.lfs.clean attribute should be "git-lfs clean -- %f" but is "git lfs clean %f"`,
			GitErrorCode.LFSAttributeDoesNotMatch,
		],
		[
			"branch rename error",
			`error: refname refs/heads/adding-renamefailed-error not found
      fatal: Branch rename failed`,
			GitErrorCode.BranchRenameFailed,
		],
		[
			"path does not exist error - neither on disk nor in the index",
			"fatal: path 'missing.txt' does not exist (neither on disk nor in the index).\n",
			GitErrorCode.PathDoesNotExist,
		],
		[
			"path does not exist error - in commitish",
			"fatal: path 'missing.txt' does not exist in 'HEAD'\n",
			GitErrorCode.PathDoesNotExist,
		],
		[
			"invalid object name error",
			"fatal: invalid object name 'HEAD'.\n",
			GitErrorCode.InvalidObjectName,
		],
		[
			"is outside repository error",
			"fatal: /missing.txt: '/missing.txt' is outside repository\n",
			GitErrorCode.OutsideRepository,
		],
		[
			"lock file exists error",
			`Unable to create  'path_to_repo/.git/index.lock: File exists.

Another git process seems to be running in this repository, e.g.
an editor opened by 'git commit'. Please make sure all processes
are terminated then try again. If it still fails, a git process
may have crashed in this repository earlier:
remove the file manually to continue.`,
			GitErrorCode.LockFileAlreadyExists,
		],
		[
			"the previous not found repository error",
			"fatal: Not a git repository (or any of the parent directories): .git",
			GitErrorCode.NotAGitRepository,
		],
		[
			"the current found repository error",
			"fatal: not a git repository (or any of the parent directories): .git",
			GitErrorCode.NotAGitRepository,
		],
		[
			"no merge to abort error",
			"fatal: There is no merge to abort (MERGE_HEAD missing).\n",
			GitErrorCode.NoMergeToAbort,
		],
		[
			"pulling non-existent remote branch error",
			"Your configuration specifies to merge with the ref 'refs/heads/tierninho-patch-1'\nfrom the remote, but no such ref was fetched.\n",
			GitErrorCode.NoExistingRemoteBranch,
		],
		[
			"local files overwritten error",
			"error: Your local changes to the following files would be overwritten by checkout:\n",
			GitErrorCode.LocalChangesOverwritten,
		],
		[
			"local untracked files overwritten error",
			"error: The following untracked working tree files would be overwritten by checkout:\n",
			GitErrorCode.LocalChangesOverwritten,
		],
		[
			"unresolved conflicts error",
			`2-simple-rebase-conflict/LICENSE.md: needs merge
You must edit all merge conflicts and then
mark them as resolved using git add`,
			GitErrorCode.UnresolvedConflicts,
		],
		[
			"failed to sign data error within a rebase",
			`Rebasing (1/4)
      Rebasing (2/4)
      error: gpg failed to sign the data`,
			GitErrorCode.GPGFailedToSignData,
		],
		[
			"could not resolve host error",
			`"Cloning into '/cloneablepath/'...\nfatal: unable to access 'https://github.com/Daniel-McCarthy/dugite.git/': Could not resolve host: github.com\n"`,
			GitErrorCode.HostDown,
		],
		[
			"conflict modify delete error",
			"CONFLICT (modify/delete): a/path/to/a/file.md deleted in HEAD and modified in 1234567 (A commit message). Version 1234567 (A commit message) of a/path/to/a/file.md left in tree.",
			GitErrorCode.ConflictModifyDeletedInBranch,
		],
		[
			"path exists but not in ref",
			"fatal: path 'README.md' exists on disk, but not in '4b825dc642cb6eb9a060e54bf8d69288fbee4904'",
			GitErrorCode.PathExistsButNotInRef,
		],
		[
			"Xcode license not agreed error",
			"You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license.",
			GitErrorCode.XcodeLicenseNotAgreed,
		],
		[
			"Xcode license requires admin privileges error",
			"Agreeing to the Xcode/iOS license requires admin privileges, please re-run as root via sudo.",
			GitErrorCode.XcodeLicenseNotAgreed,
		],
		[
			"Xcode command line tools missing error",
			"xcode-select: note: No developer tools were found, requesting install.\nIf developer tools are located at a non-default location on disk, use `sudo xcode-select --switch path/to/Xcode.app` to specify the Xcode that you wish to use for command line developer tools, and cancel the installation dialog.\nSee `man xcode-select` for more details.\n",
			GitErrorCode.XcodeCommandLineToolsMissing,
		],
	] as const;

	it.each(cases)("can parse %s", (_, stderr, expected) => {
		expect(parseError(stderr)).toBe(expected);
	});

	it("returns null for unknown stderr", () => {
		expect(parseError("some unknown failure")).toBeNull();
	});

	it("each error code has its corresponding regexp", () => {
		const errorCodes = Object.values(GitErrorCode).filter(
			(value): value is GitErrorCode => typeof value === "number",
		);
		const regexes = Object.values(GitErrorRegexes);

		expect(errorCodes.filter((code) => !regexes.includes(code))).toEqual([]);
		expect(regexes.filter((regex) => !errorCodes.includes(regex))).toEqual([]);
	});
});

describe("parseBadConfigValueErrorInfo", () => {
	it("detects bad boolean config value", () => {
		expect(
			parseBadConfigValueErrorInfo("fatal: bad boolean config value 'nab' for 'core.autocrlf'"),
		).toEqual({ key: "core.autocrlf", value: "nab" });
	});

	it("detects bad numeric config value", () => {
		expect(
			parseBadConfigValueErrorInfo(
				"fatal: bad numeric config value 'nan' for 'core.repositoryformatversion'",
			),
		).toEqual({ key: "core.repositoryformatversion", value: "nan" });
	});

	it("returns null when stderr does not match", () => {
		expect(parseBadConfigValueErrorInfo("some other failure")).toBeNull();
	});
});
