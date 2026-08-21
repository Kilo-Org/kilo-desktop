import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

interface NotebookViewerCapability {
	openFile(options: {
		readonly sessionId: string;
		readonly path: string;
	}): Promise<{ readonly error?: string }>;
}

interface NotebookCapabilities extends Record<string, unknown> {
	readonly notebookViewer: NotebookViewerCapability;
}

export function isNotebookFile(relativePath: string): boolean {
	return relativePath.toLowerCase().endsWith(".ipynb");
}

export function absoluteWorkspaceFilePath(
	workspaceDirectory: string,
	relativePath: string,
): string {
	return `${workspaceDirectory.replace(/[\\/]+$/u, "")}/${relativePath.replace(/^[\\/]+/u, "")}`;
}

export function openNotebookFile(
	sdk: SDK,
	options: {
		readonly sessionId: string;
		readonly workspaceDirectory: string;
		readonly relativePath: string;
	},
): Promise<{ readonly error?: string }> | undefined {
	return sdk.plugins.get<NotebookCapabilities>("notebook")?.notebookViewer.openFile({
		sessionId: options.sessionId,
		path: absoluteWorkspaceFilePath(options.workspaceDirectory, options.relativePath),
	});
}
