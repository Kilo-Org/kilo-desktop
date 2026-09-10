import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { gitContract, type GitCapabilities } from "../contracts/schemas.js";
import { createGitProtocolHandler } from "./git-protocol.js";
import { GitService } from "./git-service.js";

/**
 * Main-process registration for the git plugin.
 *
 * Main-only by design: git needs Node and the system git binary, so there is
 * no `browserRegister` and browser mode skips the plugin (its web-side
 * "Changes" tab then degrades to the error state — `kilo-git://` fetches
 * reject there). No feature-flag gate: core infrastructure, not a flagged
 * product feature. The `gitService` capability exposes the same service
 * surface to other plugins (e.g. files' git status decorations) without them
 * depending on this package or its IPC channels.
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
		getDiffContents: (args) => service.getDiffContents(args),
	});

	mainSdk.protocol?.handle("kilo-git", createGitProtocolHandler({ service }));

	mainSdk.plugins.expose("gitService", {
		status: service.status.bind(service),
		available: service.available.bind(service),
	} satisfies GitCapabilities["gitService"]);

	// Best-effort sweep of patch files still in flight at teardown; the
	// handler's stream-close hook owns the normal termination path.
	mainSdk.onDispose(() => void service.dispose());
}
