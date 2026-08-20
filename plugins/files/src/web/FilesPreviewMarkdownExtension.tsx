import type { MarkdownRendererExtension } from "@anaconda-agentic-desktop/ui/components/markdown-extension";

import { FileLinkChip } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
} from "./file-markdown-extension.js";

export function createFilesPreviewMarkdownExtension({
	workspaceDirectory,
	relativePath,
	onOpenFile,
}: {
	readonly workspaceDirectory: string;
	readonly relativePath: string;
	readonly onOpenFile: (relativePath: string) => void;
}): MarkdownRendererExtension {
	function PreviewFileLink({ fileTarget, parentSuffix, ...props }: FileMarkdownLinkProps) {
		return (
			<FileLinkChip
				{...props}
				fileTarget={fileTarget}
				onOpenFile={(file) => onOpenFile(file.relativePath)}
				{...(parentSuffix ? { parentSuffix } : {})}
			/>
		);
	}

	return createFileMarkdownExtension({
		workspaceFolders: [{ path: workspaceDirectory, isPrimary: true }],
		relativeTo: relativePath,
		Link: PreviewFileLink,
	});
}
