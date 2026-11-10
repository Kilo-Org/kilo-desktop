import path from "node:path";

import { z } from "zod";

import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import {
	defineTool,
	type ToolCallContext,
	type ToolImplementation,
} from "@kilo-desktop/plugin-core/contracts";
import type { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	FILE_OBJECT_TYPE,
	NOTEBOOK_PANE_KIND,
	NOTEBOOK_PANE_METADATA,
	notebookIdOf,
} from "../contracts/index.js";
import type { NotebookPanes } from "./notebook-panes.js";

/**
 * Model-facing policy for the desktop notebook tools: their descriptions steer
 * the agent away from nteract MCP's create / show, which open the external
 * nteract app.
 */
const DESKTOP_NOTEBOOK_PANEL_POLICY =
	"Never create or show a notebook in the external nteract app. " +
	"Do not call notebooks_create_notebook, notebooks_show_notebook, or notebooks_open_notebook. " +
	"Always use these desktop notebook tools to open the notebook in the chat pane layout.";

const NO_CALLER_SESSION =
	"Notebook pane tools require an originating Kilo chat session and cannot use visual focus as ownership.";

const PANES_UNAVAILABLE = "Panes are unavailable. The sessions plugin may not be loaded.";

export interface NotebookToolsOptions {
	readonly panes: () => DomainObjectHandle<typeof Panes> | null;
	readonly notebookPanes: NotebookPanes;
}

function callerWorkSession(context: ToolCallContext): string {
	if (!context.workSessionId) throw new KernelError("PERMISSION_DENIED", NO_CALLER_SESSION);
	return context.workSessionId;
}

function requirePanes(options: NotebookToolsOptions): DomainObjectHandle<typeof Panes> {
	const panes = options.panes();
	if (!panes) throw new KernelError("UNAVAILABLE", PANES_UNAVAILABLE);
	return panes;
}

const openFileInput = z.object({
	path: z.string().min(1).describe("Absolute path of the .ipynb file to open."),
});

/**
 * Origin's WebMCP notebook tools, in main (Kilo chats only): list the calling
 * chat's work session's notebooks, open a new one, or open an `.ipynb` file
 * (reusing its pane). The ids they return are what nteract's notebook tools
 * take.
 */
export function notebookTools(options: NotebookToolsOptions): Record<string, ToolImplementation> {
	return {
		list_open: defineTool({
			description:
				"List notebooks open in the calling chat's pane layout. " +
				DESKTOP_NOTEBOOK_PANEL_POLICY +
				" Each notebook_id is the id to pass to notebooks_* cell, kernel, and save tools. " +
				"Call this to see which notebooks are already open before creating another, and to find " +
				"the notebook_id for notebooks_diagnose when the user reports a notebook or kernel error.",
			input: z.object({}),
			run: (_input, context) => {
				const workSessionId = callerWorkSession(context);
				requirePanes(options);
				return { workSessionId, notebooks: options.notebookPanes.list(workSessionId) };
			},
		}),
		open: defineTool({
			description:
				"Open a new notebook in the calling chat's pane layout and return its " +
				"notebook_id (a bare UUID). " +
				DESKTOP_NOTEBOOK_PANEL_POLICY +
				" Call this instead of notebooks_create_notebook or notebooks_show_notebook. " +
				"After it returns, use notebooks_* tools only for cells, kernel, and save — pass the " +
				"notebook_id unchanged. If connect fails immediately after open, retry with the same " +
				"notebook_id (the panel iframe may still be finishing its handshake).",
			input: z.object({}),
			run: async (_input, context) => {
				const workSessionId = callerWorkSession(context);
				const pane = await requirePanes(options).methods.open({
					workSessionId,
					kind: NOTEBOOK_PANE_KIND,
				});
				const resolved = await options.notebookPanes.resolve(workSessionId, pane.id);
				return { workSessionId, notebook_id: notebookIdOf(resolved), title: resolved.title };
			},
		}),
		open_file: defineTool({
			description:
				"Open an existing .ipynb file in the calling chat's pane layout. " +
				DESKTOP_NOTEBOOK_PANEL_POLICY +
				" Pass an absolute file path. Returns the daemon notebook_id to use unchanged with " +
				"notebooks_* cell, kernel, and save tools. Reopening the same file focuses its existing tab.",
			input: openFileInput,
			run: async ({ path: notebookPath }, context) => {
				const workSessionId = callerWorkSession(context);
				const panes = requirePanes(options);
				if (!path.isAbsolute(notebookPath)) {
					throw new KernelError("VALIDATION", "Notebook paths must be absolute.");
				}
				const existing = options.notebookPanes.findFile(workSessionId, notebookPath);
				const pane = existing
					? await panes.methods.open({
							workSessionId,
							kind: NOTEBOOK_PANE_KIND,
							paneId: existing.id,
							metadata: existing.metadata,
						})
					: await panes.methods.openObject({
							workSessionId,
							ref: { type: FILE_OBJECT_TYPE, id: notebookPath },
						});
				if (!pane || pane.kind !== NOTEBOOK_PANE_KIND) {
					throw new KernelError("UNAVAILABLE", "Notebook files can't be opened in a pane here.");
				}
				const resolved = await options.notebookPanes.resolve(workSessionId, pane.id);
				return {
					workSessionId,
					notebook_id: notebookIdOf(resolved),
					title: resolved.title,
					path: resolved.metadata[NOTEBOOK_PANE_METADATA.notebookPath] ?? notebookPath,
				};
			},
		}),
	};
}
