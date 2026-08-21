import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import { isNotebookFile, openNotebookFile } from "./notebook-files.js";

export { FilesView } from "./FilesView.js";
export { FilesMarkdownExtension } from "./FilesMarkdownExtension.js";
export { FilesTabIcon } from "./FilesTabIcon.js";

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

interface ChatRightPanelCapabilities extends Record<string, unknown> {
	readonly chatRightPanel: {
		openContributedTab(
			sessionId: string,
			definition: { readonly id: string; readonly title: string },
			options: {
				readonly instanceId: string;
				readonly title: string;
				readonly iconKey?: string;
				readonly metadata: Readonly<Record<string, string>>;
			},
		): unknown;
	};
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function webRegister(sdk: SDK): void {
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
