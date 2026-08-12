import type { MainSdk, SDK } from "@anaconda-agentic-desktop/feature-sdk";

import { notebookBrowserRegister } from "./browserRegister.js";
import { registerNotebookWebMcpTools } from "./notebook-webmcp-tools.js";

export { NotebookView } from "./NotebookView.js";
export { NotebookIcon } from "lucide-react";

/**
 * Renderer boot hook — registers WebMCP tools that open/list notebooks in the
 * kilo-ui chat right panel. Runs in Electron and browser modes.
 */
export function webRegister(sdk: SDK): void {
	registerNotebookWebMcpTools(sdk);
}

export function browserRegister(mainSdk: MainSdk): void {
	notebookBrowserRegister(mainSdk);
}
