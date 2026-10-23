/**
 * WebMCP `files_open`: lets the Kilo agent show the user a workspace file in
 * the calling chat's pane layout. The chat comes from trusted caller context;
 * kilo-ui maps it to its work session, and its `chatSessionWorkspace` capability
 * confines the path to that session's workspace folders — the same folders the
 * Files pane browses.
 */
import type { SDK, ToolInvocationContext } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import { filesContract } from "../../../contracts/schemas.js";
import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { openWorkspaceFile } from "./file-viewer.js";

/** Structural shapes of kilo-ui's capabilities — asserted, not imported. */
interface SessionsCapabilities extends Record<string, unknown> {
	/** Maps the calling chat to the work session whose panes and folders it acts on. */
	readonly sessions: {
		sessionIdOfChat(kiloSessionId: string): string | undefined;
	};
}

interface ChatSessionWorkspaceCapabilities extends Record<string, unknown> {
	readonly chatSessionWorkspace: {
		getFolders(sessionId: string): readonly { readonly path: string }[];
		resolvePath(
			sessionId: string,
			path: string,
		): { readonly workspaceDirectory: string; readonly relativePath: string } | null;
	};
}

const NO_CALLER_SESSION =
	"Opening files requires an originating Kilo chat session; visual focus is never used to pick the chat.";
const KILO_UI_UNAVAILABLE =
	"The chat pane layout is unavailable. The chat UI plugin may not be loaded.";

const openFileInput = z.object({
	path: z
		.string()
		.min(1)
		.max(32_768)
		.describe("Absolute path, or a path relative to the chat's primary workspace folder."),
	line: z.number().int().positive().optional().describe("1-based line to reveal."),
	column: z.number().int().positive().optional().describe("1-based column to reveal."),
});

type KiloUiCapabilities = Partial<
	ChatRightPanelCapabilities & ChatSessionWorkspaceCapabilities & SessionsCapabilities
>;

/** The calling chat's work session, which owns the panes and folders a tool acts on. */
function callerSession(
	kiloUi: KiloUiCapabilities | null | undefined,
	context: ToolInvocationContext,
): { sessionId: string } | { error: string } {
	const kiloSessionId = context.kiloSessionId?.trim();
	if (!kiloSessionId) return { error: NO_CALLER_SESSION };
	if (!kiloUi?.sessions) return { error: KILO_UI_UNAVAILABLE };
	// A chat no session owns (e.g. a subagent's) has no panes to open into.
	const sessionId = kiloUi.sessions.sessionIdOfChat(kiloSessionId);
	return sessionId ? { sessionId } : { error: NO_CALLER_SESSION };
}

async function openFile(
	sdk: SDK,
	args: z.infer<typeof openFileInput>,
	context: ToolInvocationContext,
) {
	const kiloUi = sdk.plugins.get<KiloUiCapabilities>("kilo-ui");
	const caller = callerSession(kiloUi, context);
	if ("error" in caller) return caller;
	const { sessionId } = caller;
	const sessionWorkspace = kiloUi?.chatSessionWorkspace;
	if (!kiloUi?.chatRightPanel || !sessionWorkspace) return { error: KILO_UI_UNAVAILABLE };

	const resolved = sessionWorkspace.resolvePath(sessionId, args.path);
	if (!resolved) {
		const folders = sessionWorkspace.getFolders(sessionId).map((folder) => folder.path);
		return {
			error:
				folders.length === 0
					? "This chat has no workspace folders, so it cannot open files."
					: `"${args.path}" is outside this chat's workspace folders: ${folders.join(", ")}.`,
		};
	}
	const { workspaceDirectory, relativePath } = resolved;
	if (!relativePath) return { error: `"${args.path}" is a folder, not a file.` };

	let paths: readonly string[];
	try {
		({ paths } = filesContract.existingPaths.output.parse(
			await sdk.invoke("existingPaths", { workspaceDirectory, relativePaths: [relativePath] }),
		));
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		return { error: `Could not check whether "${args.path}" exists: ${reason}` };
	}
	if (!paths.includes(relativePath)) {
		return { error: `File not found (or not a file): "${args.path}".` };
	}

	void openWorkspaceFile(sdk, {
		sessionId,
		workspaceDirectory,
		relativePath,
		...(args.line !== undefined ? { line: args.line } : {}),
		...(args.column !== undefined ? { column: args.column } : {}),
	});
	return {
		sessionId,
		workspaceDirectory,
		relativePath,
		...(args.line !== undefined ? { line: args.line } : {}),
		...(args.column !== undefined ? { column: args.column } : {}),
	};
}

export function registerFilesWebMcpTools(sdk: SDK): void {
	sdk.tools.register({
		name: "open",
		description:
			"Show the user a file in the Files pane of the calling chat's pane layout, optionally " +
			"revealing a line and column. Only files inside the chat's workspace folders can be " +
			"opened. Reopening a file that is already open focuses its tab. This displays the file " +
			"to the user; it does not return the file's contents.",
		inputSchema: z.toJSONSchema(openFileInput, { target: "draft-2020-12" }),
		validate: openFileInput,
		annotations: { idempotentHint: true },
		exposeToModelContext: true,
		handler: (args, context) => openFile(sdk, openFileInput.parse(args), context),
	});
}
