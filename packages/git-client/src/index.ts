export { MINIMUM_GIT_VERSION, createGitClient } from "./client.js";
export type { GitClient, GitClientOptions } from "./client.js";

export type {
	IGitBufferExecutionOptions,
	IGitBufferResult,
	IGitExecutionOptions,
	IGitResult,
	IGitStringExecutionOptions,
	IGitStringResult,
} from "./git/core.js";
export {
	GitError,
	getDescriptionForError,
	isAuthFailureError,
	isGitError,
	isMaxBufferExceededError,
} from "./git/core.js";

// High-level layer (git/, lib/, models/)
export type { IStatusResult, StatusOptions, StatusExec } from "./git/status.js";
export type { CreateWorkingDirectoryPatchOptions, GitPatchFile, PatchExec } from "./git/diff.js";
export {
	DEFAULT_PATCH_MAX_BYTES,
	GitPatchTooLargeError,
	createWorkingDirectoryPatch,
} from "./git/diff.js";
export type { GetFileContentsOptions, WorkingTreeFileContents } from "./git/file-contents.js";
export {
	DEFAULT_FILE_CONTENTS_MAX_BYTES,
	GitFileTooLargeError,
	getFileContents,
} from "./git/file-contents.js";
export type { GetBlobContentsOptions, ShowExec } from "./git/show.js";
export { getBlobContents } from "./git/show.js";
export type {
	AppFileStatus,
	ConflictedFileStatus,
	ConflictsWithMarkers,
	CopiedOrRenamedFileStatus,
	FileEntry,
	ManualConflict,
	OrdinaryEntry,
	PlainFileStatus,
	RenamedOrCopiedEntry,
	SubmoduleStatus,
	TextConflictEntry,
	ManualConflictDetails,
	ManualConflictEntry,
	UnmergedEntry,
	UntrackedEntry,
	UntrackedFileStatus,
	WorkingDirectoryFileChange,
	WorkingDirectoryStatus,
} from "./models/status.js";
export {
	AppFileStatusKind,
	GitStatusEntry,
	UnmergedEntrySummary,
	isConflictedFileStatus,
	isConflictWithMarkers,
	isManualConflict,
} from "./models/status.js";
export type { IAheadBehind, IBranch, IBranchTip } from "./models/branch.js";
export type {
	DefaultBranchOptions,
	GitCommonDirOptions,
	RepositoryType,
	RevParseExec,
} from "./git/rev-parse.js";
export { getDefaultBranch, getGitCommonDir, getRepositoryType } from "./git/rev-parse.js";

export { createForEachRefParser } from "./lib/git-delimiter-parser.js";
export type { InitExec, InitOptions } from "./git/init.js";
export { initRepository } from "./git/init.js";
export type { BranchExec, BranchOptions } from "./git/branch.js";
export type { CheckoutExec, CheckoutOptions } from "./git/checkout.js";
export type { ForEachRefExec, ForEachRefOptions } from "./git/for-each-ref.js";
export type { GlobalConfigExec } from "./git/config.js";
export { getGlobalConfigValue } from "./git/config.js";
export type { RecentBranchesExec, RecentBranchesOptions } from "./git/reflog.js";
export { getRecentBranches } from "./git/reflog.js";
export type {
	ListRemotesExec,
	ListRemotesOptions,
	RemoteHeadExec,
	RemoteHeadOptions,
} from "./git/remote.js";
export { getRemoteHEAD, listRemotes } from "./git/remote.js";
export type {
	CheckRefFormatOptions,
	HeadBranch,
	SymbolicRefExec,
	SymbolicRefOptions,
} from "./git/refs.js";
export { checkRefFormat, getHeadBranch, getSymbolicRef } from "./git/refs.js";
export type { WorktreeEntry, WorktreeType } from "./models/worktree.js";
export type {
	AddWorktreeOptions,
	ListWorktreesOptions,
	PruneWorktreeOptions,
	RemoveWorktreeOptions,
	WorktreeExec,
	WorktreeOptions,
} from "./git/worktree.js";
export {
	addWorktree,
	listWorktrees,
	parseWorktreePorcelainOutput,
	pruneWorktrees,
	removeWorktree,
} from "./git/worktree.js";

// Exec layer (exec/; base types stay: the IGit* variants extend them)
export type {
	GitBufferExecutionOptions,
	GitBufferResult,
	GitExecutionOptions,
	GitResult,
	GitStringExecutionOptions,
	GitStringResult,
} from "./exec/exec.js";
export {
	ExecError,
	GitErrorCode,
	GitErrorRegexes,
	GitNotDetectedError,
	UnsupportedGitVersionError,
} from "./exec/errors.js";
export type { GitLogger } from "./logger.js";
export { parseBadConfigValueErrorInfo } from "./exec/parse-bad-config-value-error-info.js";
export { parseError } from "./exec/parse-error.js";
export { parseGitVersion, satisfies } from "./exec/version.js";
