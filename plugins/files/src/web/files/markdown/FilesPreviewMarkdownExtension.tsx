import type { MarkdownRendererExtension } from "@kilo-desktop/ui/components/markdown-extension";

import { FileLinkChip } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
} from "./file-markdown-extension.js";

interface PreviewFileLinkContext {
	readonly onOpenFile: (relativePath: string) => void;
}

function PreviewFileLink({
	fileTarget,
	linkContext,
	parentSuffix,
	requiresWorkspaceFile: _requiresWorkspaceFile,
	...props
}: FileMarkdownLinkProps<PreviewFileLinkContext>) {
	return (
		<FileLinkChip
			{...props}
			fileTarget={fileTarget}
			onOpenFile={(file) => linkContext.onOpenFile(file.relativePath)}
			{...(parentSuffix ? { parentSuffix } : {})}
		/>
	);
}

export function createFilesPreviewMarkdownExtension({
	workspaceDirectory,
	relativePath,
	onOpenFile,
}: {
	readonly workspaceDirectory: string;
	readonly relativePath: string;
	readonly onOpenFile: (relativePath: string) => void;
}): MarkdownRendererExtension {
	return createFileMarkdownExtension({
		workspaceFolders: [{ path: workspaceDirectory, isPrimary: true }],
		relativeTo: relativePath,
		linkContext: { onOpenFile },
		Link: PreviewFileLink,
	});
}
