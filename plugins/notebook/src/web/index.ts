import type { MainSdk, SDK } from "@kilo-desktop/feature-sdk";

import { notebookBrowserRegister } from "./browserRegister.js";
import {
	openNotebookFileInSession,
	registerNotebookWebMcpTools,
	type NotebookPanelOpenFileResult,
} from "./notebook/notebook-webmcp-tools.js";

export { NotebookView } from "./notebook/NotebookView.js";
export { NotebookIcon } from "lucide-react";

export interface NotebookViewerCapability extends Record<string, unknown> {
	openFile(options: {
		readonly sessionId: string;
		readonly path: string;
	}): Promise<NotebookPanelOpenFileResult>;
}

export interface NotebookCapabilities extends Record<string, unknown> {
	readonly notebookViewer: NotebookViewerCapability;
}

/**
 * Renderer boot hook — registers WebMCP tools that open/list notebooks in the
 * kilo-ui chat pane layout. Runs in Electron and browser modes.
 */
export function webRegister(sdk: SDK): void {
	sdk.plugins.expose("notebookViewer", {
		openFile: ({ sessionId, path }) => openNotebookFileInSession(sdk, path, sessionId),
	} satisfies NotebookViewerCapability);
	registerNotebookWebMcpTools(sdk);
}

export function browserRegister(mainSdk: MainSdk): void {
	notebookBrowserRegister(mainSdk);
}
