import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import type { MarkdownRendererExtensionFactory } from "@anaconda-agentic-desktop/ui/components/markdown-extension";

import { FileLinkChip } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
} from "./file-markdown-extension.js";
import type { FilesCapabilities } from "./index.js";
import type { MarkdownFileWorkspaceFolder } from "./markdown-file-links.js";

interface ChatMarkdownExtensionContext {
	readonly sessionId: string;
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
}

export const FilesMarkdownExtension: MarkdownRendererExtensionFactory<
	ChatMarkdownExtensionContext
> = (context) => {
	function ChatFileLink({ fileTarget, parentSuffix, ...props }: FileMarkdownLinkProps) {
		const sdk = useSdk("files");
		return (
			<FileLinkChip
				{...props}
				fileTarget={fileTarget}
				onOpenFile={(file) => {
					sdk.plugins.get<FilesCapabilities>("files")?.fileViewer.openFile({
						sessionId: context.sessionId,
						...file,
					});
				}}
				{...(parentSuffix ? { parentSuffix } : {})}
			/>
		);
	}

	return createFileMarkdownExtension({
		workspaceFolders: context.workspaceFolders,
		Link: ChatFileLink,
	});
};
