/**
 * WebMCP `git_changes_open`: lets the Kilo agent point the user at its
 * uncommitted work by opening the calling chat's Changes tab, optionally on
 * one workspace folder or changed file. Session identity comes from trusted
 * caller context; kilo-ui's `chatSessionWorkspace` confines paths to that
 * chat's workspace folders. One Changes tab per chat is reused.
 */
import type { SDK, ToolInvocationContext } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import { CHANGES_TAB_METADATA } from "./changes-tab.js";
import type { KiloUiCapabilities } from "./kilo-ui-capabilities.js";

const CHANGES_TAB_DEFINITION = { id: "git.changes", title: "Changes" } as const;

const NO_CALLER_SESSION =
	"Opening Changes requires an originating Kilo chat session; visual focus is never used to pick the chat.";
const KILO_UI_UNAVAILABLE =
	"The chat pane layout is unavailable. The chat UI plugin may not be loaded.";

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

/** The calling chat's work session, which owns the panes and folders a tool acts on. */
function callerSession(
	kiloUi: Partial<KiloUiCapabilities> | null | undefined,
	context: ToolInvocationContext,
): { sessionId: string } | { error: string } {
	const kiloSessionId = context.kiloSessionId?.trim();
	if (!kiloSessionId) return { error: NO_CALLER_SESSION };
	if (!kiloUi?.sessions) return { error: KILO_UI_UNAVAILABLE };
	// A chat no session owns (e.g. a subagent's) has no panes to open into.
	const sessionId = kiloUi.sessions.sessionIdOfChat(kiloSessionId);
	return sessionId ? { sessionId } : { error: NO_CALLER_SESSION };
}

function openChanges(
	sdk: SDK,
	args: z.infer<typeof openChangesInput>,
	context: ToolInvocationContext,
) {
	const kiloUi = sdk.plugins.get<Partial<KiloUiCapabilities>>("kilo-ui");
	const caller = callerSession(kiloUi, context);
	if ("error" in caller) return caller;
	const { sessionId } = caller;
	const panel = kiloUi?.chatRightPanel;
	const sessionWorkspace = kiloUi?.chatSessionWorkspace;
	if (!panel || !sessionWorkspace) return { error: KILO_UI_UNAVAILABLE };

	const folders = sessionWorkspace.getFolders(sessionId).map((folder) => folder.path);
	if (folders.length === 0) {
		return { error: "This chat has no workspace folders, so it has no changes to show." };
	}
	const target = args.path ? sessionWorkspace.resolvePath(sessionId, args.path) : undefined;
	if (target === null) {
		return {
			error: `"${args.path}" is outside this chat's workspace folders: ${folders.join(", ")}.`,
		};
	}

	// Without a path this is only a "show the Changes tab" request: an open tab
	// keeps its metadata (and the user's folder choice) instead of being reset.
	const metadata: Record<string, string> | undefined = target
		? {
				[CHANGES_TAB_METADATA.workspaceDirectory]: target.workspaceDirectory,
				...(target.relativePath ? { [CHANGES_TAB_METADATA.revealPath]: target.relativePath } : {}),
				[CHANGES_TAB_METADATA.revealRequest]: crypto.randomUUID(),
			}
		: undefined;
	const existing = panel
		.listTabs(sessionId)
		.find((tab) => tab.definitionId === CHANGES_TAB_DEFINITION.id);
	let instanceId: string;
	if (existing) {
		if (metadata) panel.updateTab(sessionId, existing.instanceId, { metadata });
		panel.activateTab(sessionId, existing.instanceId);
		instanceId = existing.instanceId;
	} else {
		instanceId = panel.openContributedTab(
			sessionId,
			CHANGES_TAB_DEFINITION,
			metadata ? { metadata } : undefined,
		).instanceId;
	}
	return {
		sessionId,
		instanceId,
		...(target ? { workspaceDirectory: target.workspaceDirectory } : {}),
		...(target?.relativePath ? { relativePath: target.relativePath } : {}),
	};
}

export function registerGitWebMcpTools(sdk: SDK): void {
	sdk.tools.register({
		name: "changes_open",
		description:
			"Show the user the uncommitted changes (working tree vs HEAD) of the calling chat's " +
			"workspace in its Changes pane — e.g. to have them review what you changed. Pass `path` " +
			"to show a specific workspace folder, or a changed file to select and scroll to; a file " +
			"with no changes simply opens the list. The chat's existing Changes tab is reused.",
		inputSchema: z.toJSONSchema(openChangesInput, { target: "draft-2020-12" }),
		validate: openChangesInput,
		annotations: { idempotentHint: true },
		exposeToModelContext: true,
		handler: (args, context) => openChanges(sdk, openChangesInput.parse(args), context),
	});
}
