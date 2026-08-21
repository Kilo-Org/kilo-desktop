import { useQuery } from "@tanstack/react-query";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import type { MarkdownRendererExtensionFactory } from "@anaconda-agentic-desktop/ui/components/markdown-extension";

import { type FilesServiceContract } from "../contracts/schemas.js";
import { FileLinkChip } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
	type UnresolvedInlineCodeProps,
} from "./file-markdown-extension.js";
import type { FilesCapabilities } from "./index.js";
import {
	resolveMarkdownFileLink,
	type MarkdownFileLinkTarget,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";
import { checkWorkspaceFileExists } from "./file-existence-batcher.js";

interface ChatMarkdownExtensionContext {
	readonly sessionId: string;
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
}

interface ChatFileLinkContext extends ChatMarkdownExtensionContext {
	readonly primaryWorkspace: MarkdownFileWorkspaceFolder | undefined;
}

function useWorkspaceFileExists(fileTarget: MarkdownFileLinkTarget | null): boolean {
	const sdk = useSdk<FilesServiceContract>("files");
	const query = useQuery({
		queryKey: [
			sdk.featureId,
			"file-exists",
			fileTarget?.workspaceDirectory,
			fileTarget?.relativePath,
		],
		queryFn: () =>
			fileTarget
				? checkWorkspaceFileExists(sdk, fileTarget.workspaceDirectory, fileTarget.relativePath)
				: Promise.resolve(false),
		enabled: fileTarget !== null,
		staleTime: 30_000,
	});
	return query.data ?? false;
}

function ChatFileLink({
	fileTarget,
	linkContext,
	parentSuffix,
	requiresWorkspaceFile = false,
	children,
	...props
}: FileMarkdownLinkProps<ChatFileLinkContext>) {
	const sdk = useSdk("files");
	if (requiresWorkspaceFile) {
		return (
			<WorkspaceCandidateFileLink
				{...props}
				fileTarget={fileTarget}
				linkContext={linkContext}
				{...(parentSuffix ? { parentSuffix } : {})}
			>
				{children}
			</WorkspaceCandidateFileLink>
		);
	}
	return (
		<FileLinkChip
			{...props}
			children={children}
			fileTarget={fileTarget}
			onOpenFile={(file) => {
				sdk.plugins.get<FilesCapabilities>("files")?.fileViewer.openFile({
					sessionId: linkContext.sessionId,
					...file,
				});
			}}
			{...(parentSuffix ? { parentSuffix } : {})}
		/>
	);
}

function WorkspaceCandidateFileLink({
	fileTarget,
	linkContext,
	children,
	...props
}: FileMarkdownLinkProps<ChatFileLinkContext>) {
	const exists = useWorkspaceFileExists(fileTarget);
	if (!exists) return children;
	return (
		<ChatFileLink {...props} fileTarget={fileTarget} linkContext={linkContext}>
			{children}
		</ChatFileLink>
	);
}

function WorkspaceBareFileLink({
	codeText,
	linkContext,
	fallback,
}: UnresolvedInlineCodeProps<ChatFileLinkContext>) {
	const trimmed = codeText.trim();
	const candidate =
		linkContext.primaryWorkspace && !/[\s`/\\:]/u.test(trimmed)
			? resolveMarkdownFileLink(trimmed, linkContext.workspaceFolders)
			: null;
	const exists = useWorkspaceFileExists(candidate);

	return candidate && exists ? (
		<ChatFileLink href={trimmed} fileTarget={candidate} linkContext={linkContext}>
			{trimmed}
		</ChatFileLink>
	) : (
		fallback
	);
}

export const FilesMarkdownExtension: MarkdownRendererExtensionFactory<
	ChatMarkdownExtensionContext
> = (context) => {
	const primaryWorkspace =
		context.workspaceFolders.find((folder) => folder.isPrimary) ?? context.workspaceFolders[0];

	return createFileMarkdownExtension({
		workspaceFolders: context.workspaceFolders,
		linkifyPlainText: true,
		linkContext: { ...context, primaryWorkspace },
		Link: ChatFileLink,
		UnresolvedInlineCode: WorkspaceBareFileLink,
	});
};
