import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

/**
 * Full-fidelity zod mirror of git-client's status result types
 * (`packages/git-client/src/models/status.ts`). Redeclared with string
 * literals instead of importing the client so a future web bundle can
 * import this module without pulling Node-only code. Alignment with the
 * client types is enforced by `tsc` at the `handleAll` registration site.
 */

/**
 * Path segments of the managed chat-worktree directory
 * (`<main root>/.kilo/worktrees/`) — the single source of the convention.
 * Plain const (no `node:path`) so web bundles can import it; files and
 * terminal hardcode the same segments in production and pin against this
 * const in their tests.
 */
export const KILO_WORKTREE_SEGMENTS = [".kilo", "worktrees"] as const;

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

export const gitRenameWorktreeBranchInputSchema = z.object({
	path: z.string().min(1).max(32_768),
	currentBranch: z.string().min(1).max(255),
	requestedBranch: z.string().min(1).max(255),
});

export const gitRemoveWorktreeInputSchema = z.object({
	path: z.string().min(1).max(32_768),
});

/**
 * Feature-SDK contract (unprefixed; scoped by featureId).
 *
 * `status` resolves `null` when the working directory is not inside a git
 * repository (git-client maps any `git status` exit 128 — including a
 * missing directory — to `null`).
 *
 * `branches` follows the same `null`-means-not-a-repo semantics. Its
 * result also carries the detected `defaultBranch` (absent when no
 * branch matches the remote HEAD / `init.defaultBranch` / `main`
 * chain) and `recentBranches` (recently checked-out local branch names).
 *
 * `repositoryType` is the explicit probe the branch switcher gates on:
 * only `kind: "regular"` workspaces get a selector. It never resolves
 * `null` — `missing` (and `bare`/`unsafe`) are explicit kinds.
 *
 * `checkout` switches to a local branch; `kind: "remote"` creates a local
 * tracking branch from the named remote-tracking ref. `create` additionally
 * creates the branch first (create-then-checkout, like GitHub Desktop).
 * `startPoint` is only meaningful with `create: true` — the branch to base
 * the new branch on; omitted means the current HEAD (Desktop's
 * `startPoint: string | null`, with `undefined` for `null`).
 *
 * `available` is a zero-arg probe: `true` when a git version was obtained,
 * `false` when the binary is missing or anything else failed. Failures are
 * outcomes, not errors — the handler collapses every throw into `false`.
 *
 * `init` turns a plain working directory into an (unborn) git repository
 * (GitHub Desktop parity: one `git -c init.defaultBranch=<branch> init`,
 * the branch from the global config falling back to `main`, no initial
 * commit). Idempotent — reinitializing an existing repository is a
 * harmless no-op.
 *
 * `defaultBranch` resolves the repository's default branch name
 * (`origin/HEAD` symref, else local `main`, else `master`) or `null` when
 * no candidate exists — the base-branch picker's default.
 */
export const gitContract = defineContract({
	status: defineMethod(
		z.object({ workingDirectory: z.string().min(1).max(32_768) }),
		gitStatusSchema.nullable(),
	),
	branches: defineMethod(
		z.object({ workingDirectory: z.string().min(1).max(32_768) }),
		gitBranchesResultSchema.nullable(),
	),
	repositoryType: defineMethod(
		z.object({ workingDirectory: z.string().min(1).max(32_768) }),
		gitRepositoryTypeSchema,
	),
	checkout: defineMethod(
		z.object({
			workingDirectory: z.string().min(1).max(32_768),
			branch: z.string().min(1).max(255),
			create: z.boolean().optional(),
			/** Only meaningful with `create: true`; omitted = current HEAD. */
			startPoint: z.string().min(1).max(255).optional(),
			kind: z.enum(["local", "remote"]).optional(),
		}),
		z.undefined(),
	),
	available: defineMethod(z.undefined(), z.boolean()),
	/**
	 * Initialize the working directory as a git repository with the
	 * configured default branch (global `init.defaultBranch`, fallback
	 * `main`). Idempotent; no initial commit is created.
	 */
	init: defineMethod(z.object({ workingDirectory: z.string().min(1).max(32_768) }), z.undefined()),
	/**
	 * Both sides of a working-tree file's contents for diff hunk expansion:
	 * the old side from HEAD, the new side from disk. Null sides mean that
	 * side is absent (new/untracked file, deleted file, unborn HEAD).
	 */
	getDiffContents: defineMethod(
		z.object({
			workingDirectory: z.string().min(1).max(32_768),
			path: z.string().min(1).max(32_768),
			oldPath: z.string().min(1).max(32_768).optional(),
		}),
		z.object({
			oldContents: z.string().nullable(),
			newContents: z.string().nullable(),
		}),
	),
	defaultBranch: defineMethod(
		z.object({ workingDirectory: z.string().min(1).max(32_768) }),
		z.string().nullable(),
	),
});

const workingDirectoryInput = z.object({ workingDirectory: z.string().min(1).max(32_768) });
const githubCliStatusSchema = z.enum(["ready", "missing", "unauthenticated", "timeout", "error"]);
const pullRequestSchema = z.object({
	number: z.number().int().positive(),
	url: z.url(),
	title: z.string().min(1),
	baseBranch: z.string().min(1),
	headBranch: z.string().min(1),
	state: z.enum(["open", "closed", "merged"]),
	isDraft: z.boolean(),
});

const pullRequestSnapshotSchema = z.object({
	identity: z.string().nullable(),
	branch: z.string().nullable(),
	repository: z.string().nullable(),
	parentRepository: z.string().nullable(),
	pullRequest: pullRequestSchema.nullable(),
	/** `unsupported`: no branch or a non-GitHub origin; never spawns `gh`. */
	githubStatus: z.union([githubCliStatusSchema, z.literal("unsupported")]),
});
export const MAX_BATCHED_DIRECTORIES = 200;

export const gitActionsContract = defineContract({
	githubCliStatus: defineMethod(
		z.object({ force: z.boolean().optional() }),
		z.object({ status: githubCliStatusSchema }),
	),
	fetch: defineMethod(workingDirectoryInput, z.undefined()),
	stageChanges: defineMethod(
		workingDirectoryInput,
		z.object({
			statusSummary: z.string(),
			diffPatch: z.string(),
			recentCommitSubjects: z.array(z.string()),
		}),
	),
	commit: defineMethod(
		z.object({
			workingDirectory: z.string().min(1).max(32_768),
			message: z.string().trim().min(1).max(10_000),
		}),
		z.undefined(),
	),
	/** Pushes the branch checked out at call time (resolved main-side). */
	push: defineMethod(workingDirectoryInput, z.undefined()),
	pull: defineMethod(workingDirectoryInput, z.undefined()),
	originUrl: defineMethod(workingDirectoryInput, z.string().nullable()),
	pullRequest: defineMethod(workingDirectoryInput, pullRequestSchema.nullable()),
	pullRequestSnapshot: defineMethod(workingDirectoryInput, pullRequestSnapshotSchema),
	/**
	 * Batched `pullRequestSnapshot`; a `null` snapshot is a directory the
	 * batch could not answer, to be looked up individually.
	 */
	pullRequestSnapshots: defineMethod(
		z.object({
			workingDirectories: z.array(z.string().min(1).max(32_768)).max(MAX_BATCHED_DIRECTORIES),
		}),
		z.array(
			z.object({
				workingDirectory: z.string(),
				snapshot: pullRequestSnapshotSchema.nullable(),
			}),
		),
	),
	createPullRequest: defineMethod(
		z.object({
			workingDirectory: z.string().min(1).max(32_768),
			baseBranch: z.string().min(1).max(255),
			headBranch: z.string().min(1).max(255),
			title: z.string().trim().min(1).max(256),
			body: z.string().max(65_536),
		}),
		pullRequestSchema,
	),
	pullRequestContext: defineMethod(
		z.object({
			workingDirectory: z.string().min(1).max(32_768),
			baseBranch: z.string().min(1).max(255),
		}),
		z.object({
			commitSummary: z.string(),
			diffSummary: z.string(),
			diffPatch: z.string(),
			recentCommitSubjects: z.array(z.string()),
			pullRequestTemplate: z.string().nullable(),
		}),
	),
	workingTreeStats: defineMethod(
		workingDirectoryInput,
		z.object({
			additions: z.number().int().nonnegative(),
			deletions: z.number().int().nonnegative(),
		}),
	),
});

export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitBranchesResult = z.infer<typeof gitBranchesResultSchema>;
export type GitRepositoryType = z.infer<typeof gitRepositoryTypeSchema>;
export type GitCreateWorktreeInput = z.infer<typeof gitCreateWorktreeInputSchema>;
export type GitWorktreeResult = z.infer<typeof gitWorktreeResultSchema>;
export type GitRenameWorktreeBranchInput = z.infer<typeof gitRenameWorktreeBranchInputSchema>;
export type GitRemoveWorktreeInput = z.infer<typeof gitRemoveWorktreeInputSchema>;

/**
 * Capability type for consumers resolving the git plugin via
 * `mainSdk.plugins.get`. The worktree surface is capability-only by design:
 * creation, rename, and removal are main-process orchestration (kilo-ui
 * calls them while preparing or cleaning up chat sessions) and never cross
 * the renderer IPC boundary.
 *
 * Usage:
 * ```ts
 * const git = mainSdk.plugins.get<GitCapabilities>("git");
 * const status = await git?.gitService.status(workingDirectory);
 * const worktree = await git?.gitService.createWorktree({ workingDirectory });
 * ```
 */
export type GitCapabilities = {
	readonly gitService: {
		status(workingDirectory: string): Promise<GitStatus | null>;
		available(): Promise<boolean>;
		createWorktree(input: GitCreateWorktreeInput): Promise<GitWorktreeResult>;
		renameWorktreeBranch(input: GitRenameWorktreeBranchInput): Promise<{ branch: string } | null>;
		removeWorktree(input: GitRemoveWorktreeInput): Promise<void>;
		hasWorktreeWork(input: { directory: string; baseBranch?: string }): Promise<boolean>;
		linkAgentManagerSession(input: {
			path: string;
			sessionId: string;
			baseRef?: string;
		}): Promise<boolean>;
	};
};

/** Method-style service type inferred from the contract. */
export type GitServiceContract = InferContract<typeof gitContract> &
	InferContract<typeof gitActionsContract>;

/**
 * The draft-selection state store is a cross-plugin contract: this module
 * owns its name, key, and value shape, and kilo-ui imports them at send
 * time (`sdk.state.get(GIT_DRAFT_SELECTION_STORE_KEY)`) instead of keeping
 * a mirrored copy. The key is derived from the name so the registration
 * (git's `webRegister`) and the consumer (kilo-ui) cannot drift.
 */

/** Store name within the git feature; the namespaced key is `git.<name>`. */
export const DRAFT_SELECTION_STORE_NAME = "draft-worktree-selection";

/**
 * Fully-qualified store key: one workspace's git draft selection (run the
 * next session in the local checkout or in a freshly created worktree).
 */
export const GIT_DRAFT_SELECTION_STORE_KEY = `git.${DRAFT_SELECTION_STORE_NAME}`;

/**
 * One workspace's selection: `local` (the main checkout) or `worktree`
 * (based on `baseBranch` — absent means the service's default-branch chain).
 */
export type GitDraftWorktreeSelection =
	| { mode: "local" }
	| { mode: "worktree"; baseBranch?: string };

/**
 * Store value: selections keyed by workspace id, so one store instance
 * serves every workspace and updates preserve other entries' references.
 */
export type GitDraftSelectionStoreValue = Record<string, GitDraftWorktreeSelection>;

/**
 * The pull-request status state store is a cross-plugin contract like the
 * draft selection: git owns its name, key, and value shape; kilo-ui reads
 * it to filter the session list by pull request.
 */

/** Store name within the git feature; the namespaced key is `git.<name>`. */
export const PULL_REQUEST_STATUS_STORE_NAME = "pull-request-status";

/** Fully-qualified store key: the known pull request per PR status target. */
export const GIT_PULL_REQUEST_STATUS_STORE_KEY = `git.${PULL_REQUEST_STATUS_STORE_NAME}`;

/**
 * What the session list filter needs to know about a target's pull request;
 * drafts are `open`. Add fields when a consumer reads them, since every
 * field change re-publishes the store.
 */
export type GitPullRequestSummary = {
	state: "open" | "closed" | "merged";
};

/**
 * Store value: pull requests keyed by PR status target id (the session's
 * git status id). Only targets with a known pull request have an entry, so
 * a missing key means "no pull request" or "not looked up yet".
 */
export type GitPullRequestStatusStoreValue = Record<string, GitPullRequestSummary>;
