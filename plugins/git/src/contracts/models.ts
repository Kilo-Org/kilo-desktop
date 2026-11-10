import { z } from "zod";

/**
 * Full-fidelity zod mirror of git-client's status result types
 * (`packages/git-client/src/models/status.ts`). Redeclared with string
 * literals instead of importing the client so web bundles can import this
 * module without pulling Node-only code. Alignment with the client types is
 * enforced by `tsc` where main provides `kilo.git/repository`.
 */

/** The managed worktree directory (`<main root>/.kilo/worktrees/`), owned by kilo.work-sessions. */
export { KILO_WORKTREE_SEGMENTS } from "@kilo-desktop/plugin-work-sessions/contracts";

/** `GitStatusEntry` */
export const gitStatusEntrySchema = z.enum(["M", "A", "D", "R", "C", ".", "?", "!", "U"]);

/** `UnmergedEntrySummary` */
export const unmergedEntrySummarySchema = z.enum([
	"added-by-us",
	"deleted-by-us",
	"added-by-them",
	"deleted-by-them",
	"both-deleted",
	"both-added",
	"both-modified",
]);

/** `SubmoduleStatus` */
export const submoduleStatusSchema = z.object({
	commitChanged: z.boolean(),
	modifiedChanges: z.boolean(),
	untrackedChanges: z.boolean(),
});

/**
 * `UnmergedEntry` (text or manual conflict). The text-vs-manual distinction
 * lives in `conflictMarkerCount`, which `getStatus` never returns, so a
 * single object is lossless for the status endpoint.
 */
export const conflictEntrySchema = z.object({
	kind: z.literal("conflicted"),
	action: unmergedEntrySummarySchema,
	us: gitStatusEntrySchema,
	them: gitStatusEntrySchema,
	submoduleStatus: submoduleStatusSchema.optional(),
});

/** `AppFileStatus` */
export const appFileStatusSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.enum(["New", "Modified", "Deleted"]),
		submoduleStatus: submoduleStatusSchema.optional(),
	}),
	z.object({
		kind: z.enum(["Copied", "Renamed"]),
		oldPath: z.string(),
		renameIncludesModifications: z.boolean(),
		submoduleStatus: submoduleStatusSchema.optional(),
	}),
	z.object({
		kind: z.literal("Untracked"),
		submoduleStatus: submoduleStatusSchema.optional(),
	}),
	z.object({
		kind: z.literal("Conflicted"),
		entry: conflictEntrySchema,
		submoduleStatus: submoduleStatusSchema.optional(),
	}),
]);

/** `WorkingDirectoryFileChange` */
export const workingDirectoryFileChangeSchema = z.object({
	path: z.string(),
	status: appFileStatusSchema,
});

/** `IStatusResult` */
export const gitStatusSchema = z.object({
	currentBranch: z.string().optional(),
	currentUpstreamBranch: z.string().optional(),
	currentTip: z.string().optional(),
	branchAheadBehind: z
		.object({
			ahead: z.number().int().nonnegative(),
			behind: z.number().int().nonnegative(),
		})
		.optional(),
	exists: z.boolean(),
	workingDirectory: z.object({
		files: z.array(workingDirectoryFileChangeSchema),
	}),
	doConflictedFilesExist: z.boolean(),
});

/**
 * `RepositoryType` (git-client, ported from GitHub Desktop's
 * `getRepositoryType` rev-parse probe). Never `null` — `missing` is an
 * explicit kind; `unsafe` crosses the contract so a trust flow can be
 * added later without schema changes.
 */
export const gitRepositoryTypeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("bare") }),
	z.object({
		kind: z.literal("regular"),
		topLevelWorkingDirectory: z.string(),
		gitDir: z.string(),
	}),
	z.object({ kind: z.literal("missing") }),
	z.object({ kind: z.literal("unsafe"), path: z.string() }),
]);

/** `IBranch` (git-client) plus `kind` derived from the ref prefix. */
export const gitBranchSchema = z.object({
	name: z.string(),
	upstream: z.string().nullable(),
	tip: z.object({ sha: z.string() }),
	ref: z.string(),
	kind: z.enum(["local", "remote"]),
});

/**
 * `branches` result: local branches plus remote-tracking branches that no
 * local branch already tracks, and the branch HEAD is on. `currentBranch`
 * is absent on detached HEAD and unborn repositories.
 *
 * `defaultBranch` is the detected default branch's contract `name`
 * (GitHub Desktop's `findDefaultBranch` resolution; a remote-only hit is
 * e.g. `origin/main`), absent when nothing matches. `recentBranches`
 * are the names of the local branches most recently checked out (reflog
 * order, default branch excluded, deleted names dropped), possibly empty.
 */
export const gitBranchesResultSchema = z.object({
	currentBranch: z.string().optional(),
	branches: z.array(gitBranchSchema),
	defaultBranch: z.string().optional(),
	recentBranches: z.array(z.string()),
});

export const gitCreateWorktreeInputSchema = z.object({
	workingDirectory: z.string().min(1).max(32_768),
	baseBranch: z.string().min(1).max(255).optional(),
});

export const gitWorktreeResultSchema = z.object({
	directory: z.string(),
	branch: z.string(),
	/**
	 * Set when the worktree was created from a degraded base — e.g. the
	 * fetch of the latest base branch failed, so the branch was cut from
	 * local state. Surfaced to the session as a non-blocking warning.
	 */
	warning: z.string().optional(),
	/**
	 * The ref the branch was cut from (e.g. `origin/main`); absent when cut
	 * from HEAD.
	 */
	baseRef: z.string().optional(),
});

/**
 * A worktree entry surfaced to the renderer: `path` is the resolved
 * absolute directory, `name` its `basename` (GitHub Desktop convention,
 * e.g. `kilo-ambitious-keyboard`), `branch` the short branch name (no
 * `refs/heads/` prefix), and `isMain` marks the workspace's own checkout
 * (always first in `git worktree list`). Bare, detached and prunable
 * entries, and anything outside the workspace folders, never reach this
 * shape — see `toWorktreeEntries`.
 */
export const gitWorktreeEntrySchema = z.object({
	path: z.string(),
	name: z.string(),
	branch: z.string(),
	isMain: z.boolean(),
});

export const workingDirectoryInput = z.object({ workingDirectory: z.string().min(1).max(32_768) });
export const githubCliStatusSchema = z.enum([
	"ready",
	"missing",
	"unauthenticated",
	"timeout",
	"error",
]);
export const pullRequestSchema = z.object({
	number: z.number().int().positive(),
	url: z.url(),
	title: z.string().min(1),
	baseBranch: z.string().min(1),
	headBranch: z.string().min(1),
	state: z.enum(["open", "closed", "merged"]),
	isDraft: z.boolean(),
});

export const pullRequestSnapshotSchema = z.object({
	identity: z.string().nullable(),
	branch: z.string().nullable(),
	repository: z.string().nullable(),
	parentRepository: z.string().nullable(),
	pullRequest: pullRequestSchema.nullable(),
	/** `unsupported`: no branch or a non-GitHub origin; never spawns `gh`. */
	githubStatus: z.union([githubCliStatusSchema, z.literal("unsupported")]),
});
export const MAX_BATCHED_DIRECTORIES = 200;

export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitBranchesResult = z.infer<typeof gitBranchesResultSchema>;
export type GitRepositoryType = z.infer<typeof gitRepositoryTypeSchema>;
export type GitCreateWorktreeInput = z.infer<typeof gitCreateWorktreeInputSchema>;
export type GitWorktreeResult = z.infer<typeof gitWorktreeResultSchema>;
export type GitWorktreeEntry = z.infer<typeof gitWorktreeEntrySchema>;
