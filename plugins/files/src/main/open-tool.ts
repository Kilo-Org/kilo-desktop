import { z } from "zod";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	resolvePathInFolders,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { OPEN_FILE_TOOL_ID } from "../contracts";
import { absoluteFilePath } from "../contracts/panes";
import { openFile } from "../shared/open-file";

const NO_CALLER_SESSION =
	"Opening files requires an originating Kilo chat session; visual focus is never used to pick the chat.";
const PANES_UNAVAILABLE = "The session's panes are unavailable.";

const openFileInput = z.object({
	path: z
		.string()
		.min(1)
		.max(32_768)
		.describe("Absolute path, or a path relative to the chat's primary workspace folder."),
	line: z.number().int().positive().optional().describe("1-based line to reveal."),
	column: z.number().int().positive().optional().describe("1-based column to reveal."),
});

export interface OpenToolDependencies {
	readonly foldersOf: (workSessionId: string) => readonly WorkSessionFolder[];
	readonly existingPaths: (
		workspaceDirectory: string,
		relativePaths: string[],
	) => Promise<string[]>;
}

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * `open` (`desktop_files_open`): shows the user a file of the calling chat's
 * work session, through kilo.work-sessions' openers, optionally at a line and
 * column. The work session comes from trusted caller context and the path
 * must be an existing file inside that work session's folders.
 */
export function implementOpenTool(sdk: PluginSdk, dependencies: OpenToolDependencies): void {
	sdk.extensions.implement(
		Tool,
		OPEN_FILE_TOOL_ID,
		defineTool({
			description:
				"Show the user a file in the Files pane of the calling chat's pane layout, optionally " +
				"revealing a line and column. Only files inside the chat's workspace folders can be " +
				"opened. Reopening a file that is already open focuses its tab. This displays the file " +
				"to the user; it does not return the file's contents.",
			input: openFileInput,
			run: async ({ path, line, column }, context: ToolCallContext) => {
				const { workSessionId } = context;
				if (!workSessionId) throw new Error(NO_CALLER_SESSION);
				const panes = sdk.domainObjects.get(Panes);
				if (!panes) throw new Error(PANES_UNAVAILABLE);
				const folders = dependencies.foldersOf(workSessionId);
				const resolved = resolvePathInFolders(folders, path);
				if (!resolved) {
					throw new Error(
						folders.length === 0
							? "This chat has no workspace folders, so it cannot open files."
							: `"${path}" is outside this chat's workspace folders: ${folders.map((folder) => folder.path).join(", ")}.`,
					);
				}
				const { workspaceDirectory, relativePath } = resolved;
				if (!relativePath) throw new Error(`"${path}" is a folder, not a file.`);
				let existing: string[];
				try {
					existing = await dependencies.existingPaths(workspaceDirectory, [relativePath]);
				} catch (cause) {
					throw new Error(`Could not check whether "${path}" exists: ${reason(cause)}`, { cause });
				}
				if (!existing.includes(relativePath)) {
					throw new Error(`File not found (or not a file): "${path}".`);
				}
				const pane = await openFile(panes, {
					workSessionId,
					path: absoluteFilePath(workspaceDirectory, relativePath),
					line,
					column,
				});
				if (!pane) throw new Error("No pane in this session opens files.");
				return {
					workSessionId,
					paneId: pane.id,
					workspaceDirectory,
					relativePath,
					...(line === undefined ? {} : { line }),
					...(column === undefined ? {} : { column }),
				};
			},
		}),
	);
}
