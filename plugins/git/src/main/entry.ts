import {
	definePlugin,
	KernelApp,
	mainHost,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Vcs, Workspaces, type VcsImplementation } from "@kilo-desktop/plugin-workspaces/contracts";

import { GIT_PROTOCOL_SCHEME, Repository } from "../contracts/index.js";
import { startBranchNamer } from "./branch-namer/index.js";
import { implementChangesTool } from "./changes-tool.js";
import { createGitProtocolHandler } from "./git-protocol.js";
import { GitService, type GitClientSlice, type WorkspaceAccess } from "./git-service.js";
import { providePullRequests, type PullRequestSource } from "./pull-requests/index.js";
import { isManagedBranch } from "./worktree-manager.js";

export interface GitMainOptions {
	/** Where patch files are written; git-client defaults to the OS temp folder. */
	readonly tempDir?: string;
	/** Overrides the git client (tests). */
	readonly createClient?: () => GitClientSlice;
	/** Overrides the pull request lookups (tests). */
	readonly pullRequestSource?: PullRequestSource;
}

/** kilo.workspaces' authoriser and folders, looked up per call. */
function workspaceAccess(sdk: PluginSdk): WorkspaceAccess {
	return {
		authorize: async (directory) => {
			const workspaces = sdk.domains.get(Workspaces);
			if (!workspaces) return null;
			const { allowed } = await workspaces.methods.authorize({ path: directory, rule: "inside" });
			return allowed;
		},
		folderPaths: async () => {
			const workspaces = sdk.domains.get(Workspaces);
			if (!workspaces) return null;
			return workspaces
				.getState()
				.workspaces.flatMap((workspace) => workspace.folders.map((folder) => folder.path));
		},
	};
}

/**
 * kilo.git in main. One `GitService` (and its worktree manager) serves three
 * surfaces: the `kilo.workspaces/vcs` implementation other plugins use, the
 * `kilo.git/repository` domain object git's own UI uses, and the `kilo-git`
 * protocol that streams working-tree patches. Directories are checked with
 * kilo.workspaces' `authorize` (rule `inside`, so managed worktrees under
 * `.kilo/worktrees` pass) on every renderer-reachable path, failing closed
 * while workspaces are absent; `vcs` callers are main-process plugins.
 * Successful worktree branch renames are announced as
 * `worktree-branch-renamed`. `kilo.git/pull-requests` polls the sessions'
 * pull requests through the same service. The `changes_open` agent tool
 * shows the calling chat's Changes pane. The worktree branch namer renames a
 * new worktree's branch once its chat's task is clear (`branch-namer`).
 * Patch files still in flight are swept on deactivate; normally the protocol
 * stream releases each one when it closes.
 */
export function createGitMainEntry(options: GitMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const service = new GitService({
				logger: sdk.logger,
				workspaces: workspaceAccess(sdk),
				...(options.tempDir === undefined ? {} : { tempDir: options.tempDir }),
				...(options.createClient === undefined ? {} : { createClient: options.createClient }),
			});

			const repository: DomainProvider<typeof Repository> = sdk.domains.provide(Repository, {
				initialState: {},
				methods: {
					available: () => service.available(),
					status: ({ directory }) => service.status(directory),
					branches: ({ directory }) => service.branches(directory),
					repositoryType: ({ directory }) => service.repositoryType(directory),
					defaultBranch: ({ directory }) => service.defaultBranch(directory),
					worktrees: ({ directory }) => service.worktrees(directory),
					checkout: ({ directory, branch, create, startPoint, kind }) =>
						service.checkout(directory, branch, create, startPoint, kind),
					init: ({ directory }) => service.init(directory),
					getDiffContents: ({ directory, path, oldPath }) =>
						service.getDiffContents({
							workingDirectory: directory,
							path,
							...(oldPath === undefined ? {} : { oldPath }),
						}),
					fetch: ({ directory }) => service.fetch(directory),
					stageChanges: ({ directory }) => service.stageChanges(directory),
					commit: ({ directory, message }) => service.commit(directory, message),
					push: ({ directory }) => service.push(directory),
					pull: ({ directory }) => service.pull(directory),
					originUrl: ({ directory }) => service.originUrl(directory),
					githubCliStatus: ({ force }) => service.githubCliStatus(force),
					pullRequest: ({ directory }) => service.pullRequest(directory),
					pullRequestSnapshot: ({ directory }) => service.pullRequestSnapshot(directory),
					pullRequestSnapshots: async ({ directories }) =>
						(await service.pullRequestSnapshots(directories)).map(
							({ workingDirectory, snapshot }) => ({ directory: workingDirectory, snapshot }),
						),
					createPullRequest: ({ directory, ...input }) =>
						service.createPullRequest({ workingDirectory: directory, ...input }),
					pullRequestContext: ({ directory, baseBranch }) =>
						service.pullRequestContext(directory, baseBranch),
					workingTreeStats: ({ directory }) => service.workingTreeStats(directory),
				},
			});

			const vcs: VcsImplementation = {
				available: () => service.available(),
				status: (directory) => service.status(directory),
				branches: (directory) => service.branches(directory),
				defaultBranch: (directory) => service.defaultBranch(directory),
				worktrees: (directory) => service.worktrees(directory),
				createWorktree: ({ directory, baseBranch, branch }) =>
					service.createWorktree({
						workingDirectory: directory,
						...(baseBranch === undefined ? {} : { baseBranch }),
						...(branch === undefined ? {} : { branch }),
					}),
				resolveWorktree: ({ directory, worktree }) =>
					service.resolveWorktree({ workingDirectory: directory, directory: worktree }),
				removeWorktree: ({ directory, deleteBranch }) =>
					service.removeWorktree({
						path: directory,
						...(deleteBranch === undefined ? {} : { deleteBranch }),
					}),
				renameWorktreeBranch: async ({ directory, currentBranch, requestedBranch }) => {
					const renamed = await service.renameWorktreeBranch({
						path: directory,
						currentBranch,
						requestedBranch,
					});
					if (renamed !== null) {
						repository.emit("worktree-branch-renamed", { directory, branch: renamed.branch });
					}
					return renamed;
				},
				hasWorktreeWork: (input) => service.hasWorktreeWork(input),
				isManagedBranch,
				linkAgentManagerSession: ({ directory, sessionId, baseRef }) =>
					service.linkAgentManagerSession({
						path: directory,
						sessionId,
						...(baseRef === undefined ? {} : { baseRef }),
					}),
			};
			sdk.extensions.implement(Vcs, "git", vcs);
			startBranchNamer(sdk, vcs);
			providePullRequests(sdk, {
				source: options.pullRequestSource ?? {
					snapshot: (directory) => service.pullRequestSnapshot(directory),
					snapshots: async (directories) =>
						(await service.pullRequestSnapshots(directories)).map(
							({ workingDirectory, snapshot }) => ({ directory: workingDirectory, snapshot }),
						),
				},
			});
			implementChangesTool(sdk);

			const unhandle = mainHost(sdk).protocol?.handle(
				GIT_PROTOCOL_SCHEME,
				createGitProtocolHandler({
					service,
					allowedOrigins: () => sdk.domains.get(KernelApp)?.getState().rendererOrigins ?? [],
				}),
			);
			if (unhandle) sdk.onDispose(unhandle);
			sdk.onDispose(() => void service.dispose());
		},
	});
}
