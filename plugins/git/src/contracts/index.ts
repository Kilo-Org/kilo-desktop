import { z } from "zod";

import {
	defineDomainObject,
	defineObjectType,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

import {
	gitBranchesResultSchema,
	gitRepositoryTypeSchema,
	gitStatusSchema,
	gitWorktreeEntrySchema,
	githubCliStatusSchema,
	MAX_BATCHED_DIRECTORIES,
	pullRequestSchema,
	pullRequestSnapshotSchema,
} from "./models";

export * from "./models";
export * from "./changes";
export { githubRepositoryUrl } from "./github-remote";

/**
 * kilo.git's public surface. It fills `kilo.work-sessions/vcs` (what other
 * plugins need from version control, in "copy" terms: a copy is a git
 * worktree) and owns `kilo.git/repository` for git's own actions,
 * `kilo.git/pull-requests` for the pull request of each work session's
 * directory, and the `kilo-git://diff/patch?cwd=<directory>[&unlimited=1]`
 * protocol that streams a working tree's patch to the Changes pane.
 */
export const GIT_PLUGIN_ID = "kilo.git";

/** The protocol scheme serving working-tree patches. */
export const GIT_PROTOCOL_SCHEME = "kilo-git";

/** `kilo-git://` 413 response header carrying the oversized patch's byte length. */
export const PATCH_BYTE_LENGTH_HEADER = "X-Patch-Byte-Length";

const path = z.string().min(1).max(32_768);
const branchName = z.string().min(1).max(255);
const directoryInput = z.object({ directory: path });
const nothing = z.undefined();

export const pullRequestContextSchema = z.object({
	commitSummary: z.string(),
	diffSummary: z.string(),
	diffPatch: z.string(),
	recentCommitSubjects: z.array(z.string()),
	pullRequestTemplate: z.string().nullable(),
});
export type PullRequestContext = z.output<typeof pullRequestContextSchema>;

export const stagedChangesSchema = z.object({
	statusSummary: z.string(),
	diffPatch: z.string(),
	recentCommitSubjects: z.array(z.string()),
});
export type StagedChanges = z.output<typeof stagedChangesSchema>;

export const worktreeBranchRenamedSchema = z.object({
	/** The worktree whose branch was renamed. */
	directory: z.string(),
	branch: z.string(),
});
export type WorktreeBranchRenamed = z.output<typeof worktreeBranchRenamedSchema>;

/**
 * Git in the workspace folders, for git's own UI: status, branches, diffs,
 * commits, pushes and pull requests. Every directory must be inside a
 * workspace folder (VALIDATION otherwise). Absent where git can't run (the
 * browser).
 */
export const Repository = defineDomainObject({
	id: "kilo.git/repository",
	home: "main",
	description:
		"Git in workspace folders: status, branches, diffs, commits, pushes and pull requests.",
	state: z.object({}),
	methods: {
		/** Whether git can run; never rejects. */
		available: method(nothing, z.boolean()),
		/** Null when `directory` is not in a repository. */
		status: method(directoryInput, gitStatusSchema.nullable()),
		/** Null when `directory` is not in a repository. */
		branches: method(directoryInput, gitBranchesResultSchema.nullable()),
		repositoryType: method(directoryInput, gitRepositoryTypeSchema),
		defaultBranch: method(directoryInput, z.string().nullable()),
		/** Worktrees inside workspace folders, the main checkout first; null outside a repository. */
		worktrees: method(directoryInput, z.array(gitWorktreeEntrySchema).nullable()),
		/**
		 * Switches branch; `kind: "remote"` checks out a local tracking branch.
		 * `create` makes the branch first, from `startPoint` (default HEAD).
		 */
		checkout: method(
			z.object({
				directory: path,
				branch: branchName,
				create: z.boolean().optional(),
				startPoint: branchName.optional(),
				kind: z.enum(["local", "remote"]).optional(),
			}),
			nothing,
		),
		/** Makes `directory` an unborn repository on the configured default branch; idempotent. */
		init: method(directoryInput, nothing),
		/** Both sides of a changed file, for expanding diff hunks; null where a side is absent. */
		getDiffContents: method(
			z.object({ directory: path, path, oldPath: path.optional() }),
			z.object({ oldContents: z.string().nullable(), newContents: z.string().nullable() }),
		),
		fetch: method(directoryInput, nothing),
		/** Stages everything and describes it, for writing a commit message. */
		stageChanges: method(directoryInput, stagedChangesSchema),
		commit: method(
			z.object({ directory: path, message: z.string().trim().min(1).max(10_000) }),
			nothing,
		),
		/** Pushes the branch checked out now. */
		push: method(directoryInput, nothing),
		pull: method(directoryInput, nothing),
		originUrl: method(directoryInput, z.string().nullable()),
		githubCliStatus: method(
			z.object({ force: z.boolean().optional() }),
			z.object({ status: githubCliStatusSchema }),
		),
		pullRequest: method(directoryInput, pullRequestSchema.nullable()),
		pullRequestSnapshot: method(directoryInput, pullRequestSnapshotSchema),
		/** Batched `pullRequestSnapshot`; a null snapshot is one to look up on its own. */
		pullRequestSnapshots: method(
			z.object({ directories: z.array(path).max(MAX_BATCHED_DIRECTORIES) }),
			z.array(z.object({ directory: z.string(), snapshot: pullRequestSnapshotSchema.nullable() })),
		),
		createPullRequest: method(
			z.object({
				directory: path,
				baseBranch: branchName,
				headBranch: branchName,
				title: z.string().trim().min(1).max(256),
				body: z.string().max(65_536),
			}),
			pullRequestSchema,
		),
		/** What a pull request against `baseBranch` would contain, for writing its description. */
		pullRequestContext: method(
			z.object({ directory: path, baseBranch: branchName }),
			pullRequestContextSchema,
		),
		workingTreeStats: method(
			directoryInput,
			z.object({
				additions: z.number().int().nonnegative(),
				deletions: z.number().int().nonnegative(),
			}),
		),
	},
	events: {
		/** A managed worktree's branch got a new name. */
		"worktree-branch-renamed": worktreeBranchRenamedSchema,
	},
});

/** The pull request of one directory, resolved by `kilo.git/pull-requests`; keyed by the directory. */
export const PullRequestObjectType = defineObjectType({
	id: "kilo.git/pull-request",
	description: "The pull request of a work session's directory, keyed by the directory.",
});

export const pullRequestEntrySchema = z.object({
	snapshot: pullRequestSnapshotSchema,
	/** When the snapshot was looked up (ms). */
	updatedAt: z.number(),
	/** Set when the snapshot was seeded by creating its pull request, not by a lookup. */
	createdAt: z.number().optional(),
});
export type PullRequestEntry = z.output<typeof pullRequestEntrySchema>;
export type PullRequestSnapshot = z.output<typeof pullRequestSnapshotSchema>;
export type PullRequest = z.output<typeof pullRequestSchema>;
export type GithubCliStatus = z.output<typeof githubCliStatusSchema>;

export const pullRequestsStateSchema = z.object({
	/** The last pull request lookup per work session directory. */
	byDirectory: z.record(z.string(), pullRequestEntrySchema),
	/** The GitHub CLI as the last lookup that needed it found it. */
	githubStatus: z.object({ status: githubCliStatusSchema, checkedAt: z.number() }).nullable(),
});
export type PullRequestsState = z.output<typeof pullRequestsStateSchema>;

/**
 * The pull request of each work session's directory (its copy, else its
 * workspace's primary folder), looked up in the background with the GitHub
 * CLI: every directory every 2 minutes, the ones windows show every 15
 * seconds, at most 3 lookups at a time; a directory failing 5 times in a row
 * rests for 15 minutes. Lookups pause while no window is visible.
 */
export const PullRequests = defineDomainObject({
	id: "kilo.git/pull-requests",
	home: "main",
	description: "The pull request of each work session's directory, looked up in the background.",
	state: pullRequestsStateSchema,
	lookup: (state, directory) => state.byDirectory[directory],
	objectType: PullRequestObjectType,
	methods: {
		/** The directories a window shows (its open work session's), and whether it is visible. */
		setActive: method(
			z.object({
				windowId: z.string().min(1),
				directories: z.array(path).max(64),
				visible: z.boolean(),
			}),
			nothing,
		),
		/** Looks the directory's pull request up now; `settle` looks again after 2 s and 8 s. */
		refresh: method(z.object({ directory: path, settle: z.boolean().optional() }), nothing),
		/** Shows a pull request just created for `branch` before GitHub's search finds it. */
		recordCreated: method(
			z.object({ directory: path, branch: branchName, pullRequest: pullRequestSchema }),
			nothing,
		),
	},
});

export const GIT_DEFINITIONS: PluginDefinitions = {
	domainObjects: [Repository, PullRequests],
	objectTypes: [PullRequestObjectType],
};
