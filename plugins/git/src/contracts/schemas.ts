import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

/**
 * Full-fidelity zod mirror of git-client's status result types
 * (`packages/git-client/src/models/status.ts`). Redeclared with string
 * literals instead of importing the client so a future web bundle can
 * import this module without pulling Node-only code. Alignment with the
 * client types is enforced by `tsc` at the `handleAll` registration site.
 */

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
});

export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitBranchesResult = z.infer<typeof gitBranchesResultSchema>;
export type GitRepositoryType = z.infer<typeof gitRepositoryTypeSchema>;

/**
 * Capability type for consumers resolving the git plugin via
 * `mainSdk.plugins.get`.
 *
 * Usage:
 * ```ts
 * const git = mainSdk.plugins.get<GitCapabilities>("git");
 * const status = await git?.gitService.status(workingDirectory);
 * ```
 */
export type GitCapabilities = {
	readonly gitService: {
		status(workingDirectory: string): Promise<GitStatus | null>;
		available(): Promise<boolean>;
	};
};

/** Method-style service type inferred from the contract. */
export type GitServiceContract = InferContract<typeof gitContract>;
