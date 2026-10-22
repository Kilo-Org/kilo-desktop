/** The git errors which can be parsed from failed git commands. */
export const GitErrorCode = {
	BadConfigValue: 0,
	SSHAuthenticationFailed: 1,
	SSHPermissionDenied: 2,
	HTTPSAuthenticationFailed: 3,
	RemoteDisconnection: 4,
	HostDown: 5,
	RebaseConflicts: 6,
	MergeConflicts: 7,
	HTTPSRepositoryNotFound: 8,
	SSHRepositoryNotFound: 9,
	PushNotFastForward: 10,
	BranchDeletionFailed: 11,
	DefaultBranchDeletionFailed: 12,
	RevertConflicts: 13,
	EmptyRebasePatch: 14,
	NoMatchingRemoteBranch: 15,
	NoExistingRemoteBranch: 16,
	NothingToCommit: 17,
	NoSubmoduleMapping: 18,
	SubmoduleRepositoryDoesNotExist: 19,
	InvalidSubmoduleSHA: 20,
	LocalPermissionDenied: 21,
	InvalidMerge: 22,
	InvalidRebase: 23,
	NonFastForwardMergeIntoEmptyHead: 24,
	PatchDoesNotApply: 25,
	BranchAlreadyExists: 26,
	BadRevision: 27,
	NotAGitRepository: 28,
	CannotMergeUnrelatedHistories: 29,
	LFSAttributeDoesNotMatch: 30,
	BranchRenameFailed: 31,
	PathDoesNotExist: 32,
	InvalidObjectName: 33,
	OutsideRepository: 34,
	LockFileAlreadyExists: 35,
	NoMergeToAbort: 36,
	LocalChangesOverwritten: 37,
	UnresolvedConflicts: 38,
	GPGFailedToSignData: 39,
	ConflictModifyDeletedInBranch: 40,
	ConfigLockFileAlreadyExists: 41,
	RemoteAlreadyExists: 42,
	TagAlreadyExists: 43,
	MergeWithLocalChanges: 44,
	RebaseWithLocalChanges: 45,
	MergeCommitNoMainlineOption: 46,
	UnsafeDirectory: 47,
	PathExistsButNotInRef: 48,
	XcodeLicenseNotAgreed: 49,
	XcodeCommandLineToolsMissing: 50,
	BranchAlreadyCheckedOut: 51,
} as const;
export type GitErrorCode = (typeof GitErrorCode)[keyof typeof GitErrorCode];

/** A mapping from regexes to the git error they identify. */
export const GitErrorRegexes: { [regexp: string]: GitErrorCode } = {
	"fatal: bad (?:numeric|boolean) config value '(.+)' for '(.+)'": GitErrorCode.BadConfigValue,
	"fatal: Authentication failed for 'https?://": GitErrorCode.HTTPSAuthenticationFailed,
	"fatal: Authentication failed": GitErrorCode.SSHAuthenticationFailed,
	"fatal: Could not read from remote repository.": GitErrorCode.SSHPermissionDenied,
	"The requested URL returned error: 403": GitErrorCode.HTTPSAuthenticationFailed,
	"fatal: [Tt]he remote end hung up unexpectedly": GitErrorCode.RemoteDisconnection,
	"fatal: unable to access '(.+)': Failed to connect to (.+): Host is down": GitErrorCode.HostDown,
	"Cloning into '(.+)'...\nfatal: unable to access '(.+)': Could not resolve host: (.+)":
		GitErrorCode.HostDown,
	"Resolve all conflicts manually, mark them as resolved with": GitErrorCode.RebaseConflicts,
	"(Merge conflict|Automatic merge failed; fix conflicts and then commit the result)":
		GitErrorCode.MergeConflicts,
	"fatal: repository '(.+)' not found": GitErrorCode.HTTPSRepositoryNotFound,
	"ERROR: Repository not found": GitErrorCode.SSHRepositoryNotFound,
	"\\((non-fast-forward|fetch first)\\)\nerror: failed to push some refs to '.*'":
		GitErrorCode.PushNotFastForward,
	"error: unable to delete '(.+)': remote ref does not exist": GitErrorCode.BranchDeletionFailed,
	"\\[remote rejected\\] (.+) \\(deletion of the current branch prohibited\\)":
		GitErrorCode.DefaultBranchDeletionFailed,
	"error: could not revert .*\nhint: after resolving the conflicts, mark the corrected paths\nhint: with 'git add <paths>' or 'git rm <paths>'\nhint: and commit the result with 'git commit'":
		GitErrorCode.RevertConflicts,
	"Applying: .*\nNo changes - did you forget to use 'git add'\\?\nIf there is nothing left to stage, chances are that something else\n.*":
		GitErrorCode.EmptyRebasePatch,
	"There are no candidates for (rebasing|merging) among the refs that you just fetched.\nGenerally this means that you provided a wildcard refspec which had no\nmatches on the remote end.":
		GitErrorCode.NoMatchingRemoteBranch,
	"Your configuration specifies to merge with the ref '(.+)'\nfrom the remote, but no such ref was fetched.":
		GitErrorCode.NoExistingRemoteBranch,
	"nothing to commit": GitErrorCode.NothingToCommit,
	"[Nn]o submodule mapping found in .gitmodules for path '(.+)'": GitErrorCode.NoSubmoduleMapping,
	"fatal: repository '(.+)' does not exist\nfatal: clone of '.+' into submodule path '(.+)' failed":
		GitErrorCode.SubmoduleRepositoryDoesNotExist,
	"Fetched in submodule path '(.+)', but it did not contain (.+). Direct fetching of that commit failed.":
		GitErrorCode.InvalidSubmoduleSHA,
	"fatal: could not create work tree dir '(.+)'.*: Permission denied":
		GitErrorCode.LocalPermissionDenied,
	"merge: (.+) - not something we can merge": GitErrorCode.InvalidMerge,
	"invalid upstream (.+)": GitErrorCode.InvalidRebase,
	"fatal: Non-fast-forward commit does not make sense into an empty head":
		GitErrorCode.NonFastForwardMergeIntoEmptyHead,
	"error: (.+): (patch does not apply|already exists in working directory)":
		GitErrorCode.PatchDoesNotApply,
	"fatal: [Aa] branch named '(.+)' already exists.?": GitErrorCode.BranchAlreadyExists,
	"fatal: bad revision '(.*)'": GitErrorCode.BadRevision,
	"fatal: [Nn]ot a git repository \\(or any of the parent directories\\): (.*)":
		GitErrorCode.NotAGitRepository,
	"fatal: refusing to merge unrelated histories": GitErrorCode.CannotMergeUnrelatedHistories,
	"The .+ attribute should be .+ but is .+": GitErrorCode.LFSAttributeDoesNotMatch,
	"fatal: Branch rename failed": GitErrorCode.BranchRenameFailed,
	"fatal: path '(.+)' does not exist .+": GitErrorCode.PathDoesNotExist,
	"fatal: invalid object name '(.+)'.": GitErrorCode.InvalidObjectName,
	"fatal: .+: '(.+)' is outside repository": GitErrorCode.OutsideRepository,
	"Another git process seems to be running in this repository, e.g.":
		GitErrorCode.LockFileAlreadyExists,
	"fatal: There is no merge to abort": GitErrorCode.NoMergeToAbort,
	"error: (?:Your local changes to the following|The following untracked working tree) files would be overwritten by checkout:":
		GitErrorCode.LocalChangesOverwritten,
	"You must edit all merge conflicts and then\nmark them as resolved using git add|fatal: Exiting because of an unresolved conflict":
		GitErrorCode.UnresolvedConflicts,
	"error: gpg failed to sign the data": GitErrorCode.GPGFailedToSignData,
	"CONFLICT \\(modify/delete\\): (.+) deleted in (.+) and modified in (.+)":
		GitErrorCode.ConflictModifyDeletedInBranch,
	"error: could not lock config file (.+): File exists": GitErrorCode.ConfigLockFileAlreadyExists,
	"error: remote (.+) already exists.": GitErrorCode.RemoteAlreadyExists,
	"fatal: tag '(.+)' already exists": GitErrorCode.TagAlreadyExists,
	"error: Your local changes to the following files would be overwritten by merge:\n":
		GitErrorCode.MergeWithLocalChanges,
	"error: cannot (pull with rebase|rebase): You have unstaged changes\\.\n\\s*error: [Pp]lease commit or stash them\\.":
		GitErrorCode.RebaseWithLocalChanges,
	"error: commit (.+) is a merge but no -m option was given":
		GitErrorCode.MergeCommitNoMainlineOption,
	"fatal: detected dubious ownership in repository at (.+)": GitErrorCode.UnsafeDirectory,
	"fatal: path '(.+)' exists on disk, but not in '(.+)'": GitErrorCode.PathExistsButNotInRef,
	"You have not agreed to the Xcode license agreements": GitErrorCode.XcodeLicenseNotAgreed,
	"Agreeing to the Xcode/iOS license requires admin privileges": GitErrorCode.XcodeLicenseNotAgreed,
	"xcode-select: note: No developer tools were found": GitErrorCode.XcodeCommandLineToolsMissing,
	// git >= 2.42 says "used by worktree"; older versions say "checked out".
	"fatal: '(.+)' is already (?:checked out|used by worktree) at '(.+)'":
		GitErrorCode.BranchAlreadyCheckedOut,
};

export class ExecError extends Error {
	/**
	 * The error.code property is a string label that identifies the kind of error
	 *
	 * See https://nodejs.org/api/errors.html#errorcode
	 */
	declare public readonly code?: string;

	/**
	 * The signal that terminated the process
	 */
	declare public readonly signal?: string;

	/**
	 * Whether the child process successfully received a signal from
	 * subprocess.kill(). The killed property does not indicate that the child
	 * process has been terminated.
	 */
	declare public readonly killed?: boolean;

	constructor(
		message: string,
		public readonly stdout: Buffer | string,
		public readonly stderr: Buffer | string,
		cause?: unknown,
	) {
		super(message, { cause });

		if (cause && typeof cause === "object") {
			if ("code" in cause && typeof cause.code === "string") {
				this.code = cause.code;
			}

			if ("signal" in cause && typeof cause.signal === "string") {
				this.signal = cause.signal;
			}

			if ("killed" in cause && typeof cause.killed === "boolean") {
				this.killed = cause.killed;
			}
		}
	}
}

/**
 * Thrown when no git executable can be found (which() miss, no gitPath given).
 *
 * Deliberately does not extend `ExecError`: no process ever ran, so there is no
 * stdout/stderr/exitCode to carry.
 */
export class GitNotDetectedError extends Error {
	constructor() {
		super("Git executable not found on PATH. Install git or pass gitPath to createGitClient().");
		this.name = "GitNotDetectedError";
	}
}

/**
 * Thrown when the resolved git is older than the client's minimum version.
 * Every command is refused up front, so an old git fails once with this
 * error instead of each command failing on whichever option it lacks.
 */
export class UnsupportedGitVersionError extends Error {
	constructor(
		public readonly version: string,
		public readonly minimumVersion: string,
	) {
		super(`Git ${version} is not supported. Git ${minimumVersion} or newer is required.`);
		this.name = "UnsupportedGitVersionError";
	}
}
