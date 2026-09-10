import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

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
 * Feature-SDK contract (unprefixed; scoped by featureId).
 *
 * `status` resolves `null` when the working directory is not inside a git
 * repository (git-client maps any `git status` exit 128 — including a
 * missing directory — to `null`).
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

/** Method-style service type inferred from the contract. */
export type GitServiceContract = InferContract<typeof gitContract>;
