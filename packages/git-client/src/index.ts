export { createGitClient } from "./client.js";
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
export { DEFAULT_PATCH_MAX_BYTES, createWorkingDirectoryPatch } from "./git/diff.js";
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
export type { IAheadBehind } from "./models/branch.js";

// Exec layer (exec/; base types stay: the IGit* variants extend them)
export type {
	GitBufferExecutionOptions,
	GitBufferResult,
	GitExecutionOptions,
	GitResult,
	GitStringExecutionOptions,
	GitStringResult,
} from "./exec/exec.js";
export { ExecError, GitErrorCode, GitErrorRegexes, GitNotDetectedError } from "./exec/errors.js";
export type { GitLogger } from "./logger.js";
export { parseBadConfigValueErrorInfo } from "./exec/parse-bad-config-value-error-info.js";
export { parseError } from "./exec/parse-error.js";
export { parseGitVersion, satisfies } from "./exec/version.js";
