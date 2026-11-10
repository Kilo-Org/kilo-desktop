import { z } from "zod";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	resolvePathInFolders,
	workSessionFolders,
	WorkSessions,
	Workspaces,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHANGES_OPEN_TOOL_ID, CHANGES_PANE_KIND, CHANGES_PANE_METADATA } from "../../contracts";

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

/** The folders the calling chat's work session shows; none without a workspace. */
function foldersOf(sdk: PluginSdk, workSessionId: string): WorkSessionFolder[] {
	const workSession = sdk.domainObjects
		.get(WorkSessions)
		?.getState()
		.workSessions.find((candidate) => candidate.id === workSessionId);
	if (!workSession?.workspaceId) return [];
	const workspace = sdk.domainObjects
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === workSession.workspaceId);
	return workSessionFolders(
		(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		workSession.branch ? workSession.directory : null,
	);
}

/**
 * `changes_open`: points the user at the agent's uncommitted work by showing
 * the calling chat's Changes pane, optionally on one of its work session's
 * folders or a changed file. The work session comes from trusted caller
 * context; paths must be inside that work session's folders. The work
 * session's one Changes pane is reused; without a path it is only shown,
 * keeping the folder the person picked.
 */
export function activateChangesTool(sdk: PluginSdk): void {
	sdk.extensions.implement(
		Tool,
		CHANGES_OPEN_TOOL_ID,
		defineTool({
			description:
				"Show the user the uncommitted changes (working tree vs HEAD) of the calling chat's " +
				"workspace in its Changes pane — e.g. to have them review what you changed. Pass `path` " +
				"to show a specific workspace folder, or a changed file to select and scroll to; a file " +
				"with no changes simply opens the list. The chat's existing Changes tab is reused.",
			input: openChangesInput,
			run: async ({ path }, context: ToolCallContext) => {
				const { workSessionId } = context;
				if (!workSessionId) throw new Error(NO_CALLER_SESSION);
				const panes = sdk.domainObjects.get(Panes);
				if (!panes) throw new Error(PANES_UNAVAILABLE);
				const folders = foldersOf(sdk, workSessionId);
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
					workSessionId,
					kind: CHANGES_PANE_KIND,
					...(metadata ? { metadata } : {}),
				});
				return {
					workSessionId,
					paneId: pane.id,
					...(target ? { workspaceDirectory: target.workspaceDirectory } : {}),
					...(target?.relativePath ? { relativePath: target.relativePath } : {}),
				};
			},
		}),
	);
}
