import {
	environmentReady,
	KernelApp,
	mainHost,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Notifications } from "@kilo-desktop/plugin-shell/contracts";
import {
	Vcs,
	Workspaces,
	type VcsImplementation,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { GIT_PROTOCOL_SCHEME, Repository } from "../../contracts";
import type { CloneArea } from "../clone";
import type { PullRequestSource } from "../shared/pull-request-source";
import { createGitProtocolHandler } from "./git-protocol";
import { GitService, type GitClientSlice, type WorkspaceAccess } from "./git-service";
import { isManagedBranch } from "./worktree-manager";

export interface RepositoryOptions {
	/** Replaces the git client (tests). */
	readonly createClient?: () => GitClientSlice;
}

export interface RepositoryArea {
	/** kilo.git's `kilo.work-sessions/vcs` implementation, as contributed. */
	readonly vcs: VcsImplementation;
	/** Pull request lookups through the same git service. */
	readonly pullRequestSource: PullRequestSource;
}

export const productionRepositoryOptions: RepositoryOptions = {};

/** kilo.work-sessions' authoriser and folders, looked up per call; absent workspaces answer null. */
function workspaceAccess(sdk: PluginSdk): WorkspaceAccess {
	return {
		authorize: async (directory) => {
			const workspaces = sdk.domainObjects.get(Workspaces);
			if (!workspaces) return null;
			const { allowed } = await workspaces.methods.authorize({ path: directory, rule: "inside" });
			return allowed;
		},
		folderPaths: async () => {
			const workspaces = sdk.domainObjects.get(Workspaces);
			if (!workspaces) return null;
			return workspaces
				.getState()
				.workspaces.flatMap((workspace) => workspace.folders.map((folder) => folder.path));
		},
	};
}

function provideRepository(
	sdk: PluginSdk,
	service: GitService,
	clone: CloneArea,
): DomainObjectProvider<typeof Repository> {
	return sdk.domainObjects.provide(Repository, {
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
				(await service.pullRequestSnapshots(directories)).map(({ workingDirectory, snapshot }) => ({
					directory: workingDirectory,
					snapshot,
				})),
			createPullRequest: ({ directory, ...input }) =>
				service.createPullRequest({ workingDirectory: directory, ...input }),
			pullRequestContext: ({ directory, baseBranch }) =>
				service.pullRequestContext(directory, baseBranch),
			workingTreeStats: ({ directory }) => service.workingTreeStats(directory),
			cloneWorkspace: (input) => clone.cloneWorkspace(input),
		},
	});
}

/** Announces a renamed copy branch to windows (to refetch) and the person (a toast, when kilo.shell is here). */
function announceBranchRenamed(
	sdk: PluginSdk,
	repository: DomainObjectProvider<typeof Repository>,
	directory: string,
	branch: string,
): void {
	repository.emit("worktree-branch-renamed", { directory, branch });
	void sdk.domainObjects
		.get(Notifications)
		?.methods.toast({ level: "success", title: `Branch renamed to ${branch}` })
		.catch(() => undefined);
}

function vcsOf(
	sdk: PluginSdk,
	service: GitService,
	repository: DomainObjectProvider<typeof Repository>,
): VcsImplementation {
	return {
		available: () => service.available(),
		status: (directory) => service.status(directory),
		branches: (directory) => service.branches(directory),
		defaultBranch: (directory) => service.defaultBranch(directory),
		copies: (directory) => service.worktrees(directory),
		createCopy: ({ directory, baseBranch, branch }) =>
			service.createWorktree({
				workingDirectory: directory,
				...(baseBranch === undefined ? {} : { baseBranch }),
				...(branch === undefined ? {} : { branch }),
			}),
		resolveCopy: ({ directory, copy }) =>
			service.resolveWorktree({ workingDirectory: directory, directory: copy }),
		removeCopy: ({ directory, deleteBranch }) =>
			service.removeWorktree({
				path: directory,
				...(deleteBranch === undefined ? {} : { deleteBranch }),
			}),
		renameCopyBranch: async ({ directory, currentBranch, requestedBranch }) => {
			const renamed = await service.renameWorktreeBranch({
				path: directory,
				currentBranch,
				requestedBranch,
			});
			if (renamed !== null) announceBranchRenamed(sdk, repository, directory, renamed.branch);
			return renamed;
		},
		hasCopyWork: (input) => service.hasWorktreeWork(input),
		isManagedBranch,
		linkAgentManagerSession: ({ directory, chatId, baseRef }) =>
			service.linkAgentManagerSession({
				path: directory,
				sessionId: chatId,
				...(baseRef === undefined ? {} : { baseRef }),
			}),
	};
}

/**
 * The repository area: one `GitService` (and its worktree manager) behind
 * three surfaces — the `kilo.work-sessions/vcs` contribution (a copy is a
 * git worktree), the `kilo.git/repository` domain object git's own UI uses,
 * and the `kilo-git` protocol streaming working-tree patches. Directories
 * are checked with kilo.work-sessions' `authorize` (rule `inside`, so
 * managed worktrees under `.kilo/worktrees` pass) on every renderer-reachable
 * path, failing closed while workspaces are absent; `vcs` callers are
 * main-process plugins. A successful copy branch rename is announced as
 * `worktree-branch-renamed` and toasted in the main window. `cloneWorkspace`
 * comes from the clone area `connectClone` activates with this service's git
 * client (for URL clones), the one directory not checked against workspaces
 * because it becomes a new one. Patch files still
 * in flight are swept on deactivate; normally the protocol stream releases
 * each one when it closes.
 */
export function activateRepository(
	sdk: PluginSdk,
	options: RepositoryOptions,
	connectClone: (cloneGitUrl: (url: string, destination: string) => Promise<void>) => CloneArea,
): RepositoryArea {
	const service = new GitService({
		logger: sdk.logger,
		environmentReady: () => environmentReady(sdk),
		workspaces: workspaceAccess(sdk),
		...(options.createClient === undefined ? {} : { createClient: options.createClient }),
	});
	const clone = connectClone((url, destination) => service.cloneUrl(url, destination));
	const repository = provideRepository(sdk, service, clone);
	const vcs = vcsOf(sdk, service, repository);
	sdk.extensions.implement(Vcs, "git", vcs);

	const unhandle = mainHost(sdk).protocol?.handle(
		GIT_PROTOCOL_SCHEME,
		createGitProtocolHandler({
			service,
			allowedOrigins: () => sdk.domainObjects.get(KernelApp)?.getState().rendererOrigins ?? [],
		}),
	);
	if (unhandle) sdk.onDispose(unhandle);
	sdk.onDispose(() => void service.dispose());

	return {
		vcs,
		pullRequestSource: {
			snapshot: (directory) => service.pullRequestSnapshot(directory),
			snapshots: async (directories) =>
				(await service.pullRequestSnapshots(directories)).map(({ workingDirectory, snapshot }) => ({
					directory: workingDirectory,
					snapshot,
				})),
		},
	};
}
