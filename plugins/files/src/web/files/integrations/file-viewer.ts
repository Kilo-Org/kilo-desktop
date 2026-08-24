import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { isNotebookFile, openNotebookFile } from "./notebook-viewer.js";

export interface OpenWorkspaceFileOptions {
	readonly sessionId: string;
	readonly workspaceDirectory: string;
	readonly relativePath: string;
	readonly line?: number;
	readonly column?: number;
}

export interface FileViewerCapability extends Record<string, unknown> {
	openFile(options: OpenWorkspaceFileOptions): void;
}

export interface FilesCapabilities extends Record<string, unknown> {
	readonly fileViewer: FileViewerCapability;
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function registerFileViewer(sdk: SDK): void {
	if (sdk.plugins.get<FilesCapabilities>("files")?.fileViewer) return;
	sdk.plugins.expose("fileViewer", {
		openFile({
			sessionId,
			workspaceDirectory,
			relativePath,
			line,
			column,
		}: OpenWorkspaceFileOptions) {
			if (isNotebookFile(relativePath)) {
				void openNotebookFile(sdk, { sessionId, workspaceDirectory, relativePath });
				return;
			}
			const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
			if (!panel) return;
			panel.openContributedTab(
				sessionId,
				{ id: "files.files", title: "Files" },
				{
					instanceId: `file:${workspaceDirectory}/${relativePath}`,
					title: basename(relativePath),
					iconKey: relativePath,
					metadata: {
						workspaceDirectory,
						relativePath,
						...(line !== undefined ? { line: String(line) } : {}),
						...(column !== undefined ? { column: String(column) } : {}),
					},
				},
			);
		},
	} satisfies FileViewerCapability);
}
