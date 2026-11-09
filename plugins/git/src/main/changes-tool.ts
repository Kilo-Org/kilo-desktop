import { z } from "zod";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { AgentTool, defineTool, type ToolCallContext } from "@kilo-desktop/plugin-agent/contracts";
import { Panes, WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import {
	CHANGES_PANE_KIND,
	CHANGES_PANE_METADATA,
	resolvePathInFolders,
	sessionFolders,
	type SessionFolder,
} from "../contracts/index.js";

const NO_CALLER_SESSION =
	"Opening Changes requires an originating Kilo chat session; visual focus is never used to pick the chat.";
const PANES_UNAVAILABLE = "The session's panes are unavailable.";

const openChangesInput = z.object({
	path: z
		.string()
		.min(1)
		.max(32_768)
		.optional()
		.describe(
			"Changed file or workspace folder to show: absolute, or relative to the chat's primary workspace folder.",
		),
});

/** The folders the calling chat's Work Session shows; none without a workspace. */
function foldersOf(sdk: PluginSdk, sessionId: string): SessionFolder[] {
	const session = sdk.domains
		.get(WorkSessions)
		?.getState()
		.sessions.find((candidate) => candidate.id === sessionId);
	if (!session?.workspaceId) return [];
	const workspace = sdk.domains
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === session.workspaceId);
	return sessionFolders(
		(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		session.worktreeBranch ? session.directory : null,
	);
}

/**
 * `changes_open`: points the user at the agent's uncommitted work by showing
 * the calling chat's Changes pane, optionally on one of its session's
 * folders or a changed file. The session comes from trusted caller context;
 * paths must be inside that session's folders. The session's one Changes
 * pane is reused; without a path it is only shown, keeping the folder the
 * person picked.
 */
export function implementChangesTool(sdk: PluginSdk): void {
	sdk.extensions.implement(
		AgentTool,
		"changes_open",
		defineTool({
			description:
				"Show the user the uncommitted changes (working tree vs HEAD) of the calling chat's " +
				"workspace in its Changes pane — e.g. to have them review what you changed. Pass `path` " +
				"to show a specific workspace folder, or a changed file to select and scroll to; a file " +
				"with no changes simply opens the list. The chat's existing Changes tab is reused.",
			input: openChangesInput,
			run: async ({ path }, context: ToolCallContext) => {
				const { sessionId } = context;
				if (!sessionId) throw new Error(NO_CALLER_SESSION);
				const panes = sdk.domains.get(Panes);
				if (!panes) throw new Error(PANES_UNAVAILABLE);
				const folders = foldersOf(sdk, sessionId);
				if (folders.length === 0) {
					throw new Error("This chat has no workspace folders, so it has no changes to show.");
				}
				const target = path ? resolvePathInFolders(folders, path) : undefined;
				if (target === null) {
					throw new Error(
						`"${path}" is outside this chat's workspace folders: ${folders.map((folder) => folder.path).join(", ")}.`,
					);
				}
				const metadata = target
					? {
							[CHANGES_PANE_METADATA.workspaceDirectory]: target.workspaceDirectory,
							...(target.relativePath
								? { [CHANGES_PANE_METADATA.revealPath]: target.relativePath }
								: {}),
							[CHANGES_PANE_METADATA.revealRequest]: crypto.randomUUID(),
						}
					: undefined;
				const pane = await panes.methods.open({
					sessionId,
					kind: CHANGES_PANE_KIND,
					...(metadata ? { metadata } : {}),
				});
				return {
					sessionId,
					paneId: pane.id,
					...(target ? { workspaceDirectory: target.workspaceDirectory } : {}),
					...(target?.relativePath ? { relativePath: target.relativePath } : {}),
				};
			},
		}),
	);
}
