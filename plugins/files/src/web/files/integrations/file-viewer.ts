import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { isNotebookFile, openNotebookFile } from "./notebook-viewer.js";

const DEFAULT_FILES_EXPLORER_ID = "files:explorer";
const FILES_DEFINITION_ID = "files.files";

export interface OpenWorkspaceFileOptions {
	readonly sessionId: string;
	readonly workspaceDirectory: string;
	readonly relativePath: string;
	readonly explorerId?: string;
	readonly line?: number;
	readonly column?: number;
}

export interface FileViewerCapability extends Record<string, unknown> {
	openFile(options: OpenWorkspaceFileOptions): void;
}

export interface FilesCapabilities extends Record<string, unknown> {
	readonly fileViewer: FileViewerCapability;
}

function filePaneInstanceId(
	explorerId: string,
	workspaceDirectory: string,
	relativePath: string,
): string {
	return `file:${explorerId}:${workspaceDirectory}/${relativePath}`;
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function isExplorerTab(tab: {
	readonly instanceId?: string;
	readonly definitionId?: string;
	readonly metadata?: Readonly<Record<string, string>>;
}): boolean {
	return tab.definitionId === FILES_DEFINITION_ID && tab.metadata?.relativePath == null;
}

function isSameFile(
	tab: {
		readonly definitionId?: string;
		readonly metadata?: Readonly<Record<string, string>>;
	},
	workspaceDirectory: string,
	relativePath: string,
): boolean {
	return (
		tab.definitionId === FILES_DEFINITION_ID &&
		tab.metadata?.workspaceDirectory === workspaceDirectory &&
		tab.metadata?.relativePath === relativePath
	);
}

function resolveExplorerId(
	requested: string | undefined,
	tabs: readonly {
		readonly instanceId: string;
		readonly definitionId?: string;
		readonly metadata?: Readonly<Record<string, string>>;
	}[],
): string {
	if (requested?.trim()) return requested;
	if (tabs.some((tab) => tab.instanceId === DEFAULT_FILES_EXPLORER_ID && isExplorerTab(tab))) {
		return DEFAULT_FILES_EXPLORER_ID;
	}
	return tabs.find(isExplorerTab)?.instanceId ?? DEFAULT_FILES_EXPLORER_ID;
}

export function openWorkspaceFile(sdk: SDK, options: OpenWorkspaceFileOptions): void {
	if (isNotebookFile(options.relativePath)) {
		void openNotebookFile(sdk, options);
		return;
	}
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	if (!panel) return;
	const tabs = panel.listTabs?.(options.sessionId) ?? [];
	if (!options.explorerId) {
		const existing = tabs.find((tab) =>
			isSameFile(tab, options.workspaceDirectory, options.relativePath),
		);
		if (existing) {
			panel.updateTab(options.sessionId, existing.instanceId, {
				metadata: {
					...existing.metadata,
					workspaceDirectory: options.workspaceDirectory,
					relativePath: options.relativePath,
					...(options.line !== undefined ? { line: String(options.line) } : {}),
					...(options.column !== undefined ? { column: String(options.column) } : {}),
				},
			});
			panel.activateTab?.(options.sessionId, existing.instanceId);
			return;
		}
	}
	const explorerId = resolveExplorerId(options.explorerId, tabs);
	panel.openContributedTab(
		options.sessionId,
		{ id: FILES_DEFINITION_ID, title: "Files" },
		{
			instanceId: filePaneInstanceId(explorerId, options.workspaceDirectory, options.relativePath),
			title: basename(options.relativePath),
			iconKey: options.relativePath,
			metadata: {
				explorerId,
				workspaceDirectory: options.workspaceDirectory,
				relativePath: options.relativePath,
				...(options.line !== undefined ? { line: String(options.line) } : {}),
				...(options.column !== undefined ? { column: String(options.column) } : {}),
			},
		},
	);
}

export function registerFileViewer(sdk: SDK): void {
	if (sdk.plugins.get<FilesCapabilities>("files")?.fileViewer) return;
	sdk.plugins.expose("fileViewer", {
		openFile(options: OpenWorkspaceFileOptions) {
			openWorkspaceFile(sdk, options);
		},
	} satisfies FileViewerCapability);
}
