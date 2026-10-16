import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { gitActionsContract, gitContract, type GitCapabilities } from "../contracts/schemas.js";
import { createGitProtocolHandler } from "./git-protocol.js";
import { GitService } from "./git-service.js";

/**
 * Main-process registration for the git plugin.
 *
 * Main-only by design: git needs Node and the system git binary, so there is
 * no `browserRegister` and browser mode skips the plugin (its web-side
 * "Changes" tab then degrades to the error state — `kilo-git://` fetches
 * reject there). No feature-flag gate: core infrastructure, not a flagged
 * product feature. The `gitService` capability exposes the full service
 * surface to other plugins (files' git status decorations, kilo-ui's
 * worktree session lifecycle) without them depending on this package or its
 * IPC channels; the renderer-callable methods stay behind the contract.
 */
/**
 * Capability shape exposed by kilo-ui for workspace folders (a local
 * structural interface — the environments plugin's `LocalMcpAppsCapability`
 * pattern; no cross-feature import). Only the slice git reads is modeled.
 */
interface WorkspacesCapability extends Record<string, unknown> {
	workspaceService: { list(): Promise<{ folders: readonly { path: string }[] }[]> };
}

export function mainRegister(mainSdk: MainSdk): void {
	const service = new GitService({
		logger: mainSdk.logger,
		// Resolved per call so kilo-ui's boot order never matters: the
		// capability is looked up when a request arrives, not at
		// registration. `null` (capability absent) makes GitService fail
		// closed.
		getWorkspaceFolderPaths: async () => {
			const kiloUi = mainSdk.plugins.get<WorkspacesCapability>("kilo-ui");
			if (kiloUi?.workspaceService == null) {
				return null;
			}
			const workspaces = await kiloUi.workspaceService.list();
			return workspaces.flatMap((workspace) => workspace.folders.map((folder) => folder.path));
		},
		...(mainSdk.host ? { tempDir: mainSdk.host.paths.tempDirectory() } : {}),
	});

	mainSdk.channels(gitContract).handleAll({
		status: ({ workingDirectory }) => service.status(workingDirectory),
		branches: ({ workingDirectory }) => service.branches(workingDirectory),
		repositoryType: ({ workingDirectory }) => service.repositoryType(workingDirectory),
		checkout: async ({ workingDirectory, branch, create, startPoint, kind }) => {
			await service.checkout(workingDirectory, branch, create, startPoint, kind);
			return undefined;
		},
		available: () => service.available(),
		init: async ({ workingDirectory }) => {
			await service.init(workingDirectory);
			return undefined;
		},
		getDiffContents: (args) => service.getDiffContents(args),
		defaultBranch: ({ workingDirectory }) => service.defaultBranch(workingDirectory),
	});

	mainSdk.channels(gitActionsContract).handleAll({
		githubCliStatus: ({ force }) => service.githubCliStatus(force),
		stageChanges: ({ workingDirectory }) => service.stageChanges(workingDirectory),
		fetch: async ({ workingDirectory }) => {
			await service.fetch(workingDirectory);
			return undefined;
		},
		commit: async ({ workingDirectory, message }) => {
			await service.commit(workingDirectory, message);
			return undefined;
		},
		push: async ({ workingDirectory }) => {
			await service.push(workingDirectory);
			return undefined;
		},
		pull: async ({ workingDirectory }) => {
			await service.pull(workingDirectory);
			return undefined;
		},
		originUrl: ({ workingDirectory }) => service.originUrl(workingDirectory),
		pullRequest: ({ workingDirectory }) => service.pullRequest(workingDirectory),
		pullRequestSnapshot: ({ workingDirectory }) => service.pullRequestSnapshot(workingDirectory),
		pullRequestSnapshots: ({ workingDirectories }) =>
			service.pullRequestSnapshots(workingDirectories),
		createPullRequest: (input) => service.createPullRequest(input),
		pullRequestContext: ({ workingDirectory, baseBranch }) =>
			service.pullRequestContext(workingDirectory, baseBranch),
		workingTreeStats: ({ workingDirectory }) => service.workingTreeStats(workingDirectory),
	});

	mainSdk.protocol?.handle(
		"kilo-git",
		createGitProtocolHandler({ service, allowedOrigins: mainSdk.trustedAppOrigins }),
	);

	mainSdk.plugins.expose("gitService", {
		status: service.status.bind(service),
		available: service.available.bind(service),
		createWorktree: service.createWorktree.bind(service),
		renameWorktreeBranch: async (input) => {
			const result = await service.renameWorktreeBranch(input);
			if (result !== null) {
				mainSdk.events.emit("worktree-branch-renamed", { path: input.path, branch: result.branch });
			}
			return result;
		},
		removeWorktree: service.removeWorktree.bind(service),
		hasWorktreeWork: service.hasWorktreeWork.bind(service),
		linkAgentManagerSession: service.linkAgentManagerSession.bind(service),
	} satisfies GitCapabilities["gitService"]);

	// Best-effort sweep of patch files still in flight at teardown; the
	// handler's stream-close hook owns the normal termination path.
	mainSdk.onDispose(() => void service.dispose());
}
