import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import type { MarkdownRendererExtensionFactory } from "@kilo-desktop/ui/components/markdown-extension";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { type FilesServiceContract } from "../../../contracts/schemas.js";
import { FileLinkCandidatesDialog } from "./FileLinkCandidatesDialog.js";
import { FileLinkChip, type FileLinkChipProps } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
	type UnresolvedInlineCodeProps,
} from "./file-markdown-extension.js";
import type { FilesCapabilities } from "../integrations/file-viewer.js";
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

const RESOLVED_LINK_STALE_TIME_MS = 30_000;

function notFoundMessage(relativePath: string, truncated: boolean): string {
	const message = `File not found: ${relativePath}`;
	return truncated ? `${message}. The search was incomplete.` : message;
}

type ResolvableFileLinkChipProps = Omit<FileLinkChipProps, "onOpenFile"> & {
	readonly linkContext: ChatFileLinkContext;
};

/**
 * Resolves a link against the workspace only when it is clicked, so rendering
 * a transcript never walks the workspace. An exact or single match opens
 * directly, several matches open a picker, and no match reports the miss
 * without opening the Files pane.
 */
function ResolvableFileLinkChip({
	fileTarget,
	linkContext,
	...props
}: ResolvableFileLinkChipProps) {
	const sdk = useSdk<FilesServiceContract>("files");
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	const [candidates, setCandidates] = useState<readonly string[]>([]);

	const openResolvedFile = (relativePath: string) => {
		sdk.plugins.get<FilesCapabilities>("files")?.fileViewer.openFile({
			sessionId: linkContext.sessionId,
			...fileTarget,
			relativePath,
		});
	};

	const resolveAndOpen = async () => {
		setPending(true);
		try {
			const resolution = await queryClient.fetchQuery({
				queryKey: [
					sdk.featureId,
					"resolve-file-link",
					fileTarget.workspaceDirectory,
					fileTarget.relativePath,
				],
				queryFn: () =>
					sdk.client.resolveFileLink({
						workspaceDirectory: fileTarget.workspaceDirectory,
						relativePath: fileTarget.relativePath,
					}),
				staleTime: RESOLVED_LINK_STALE_TIME_MS,
			});
			const [onlyPath] = resolution.paths;
			if (resolution.paths.length === 1 && onlyPath !== undefined) {
				openResolvedFile(onlyPath);
			} else if (resolution.paths.length > 1) {
				setCandidates(resolution.paths);
			} else {
				toast.error(notFoundMessage(fileTarget.relativePath, resolution.truncated));
			}
		} catch {
			toast.error(`Could not open ${fileTarget.relativePath}.`);
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<FileLinkChip
				{...props}
				aria-busy={pending ? true : undefined}
				fileTarget={fileTarget}
				onOpenFile={() => void resolveAndOpen()}
			/>
			{candidates.length > 0 ? (
				<FileLinkCandidatesDialog
					paths={candidates}
					onOpenChange={(open) => {
						if (!open) setCandidates([]);
					}}
					onSelect={(relativePath) => {
						setCandidates([]);
						openResolvedFile(relativePath);
					}}
				/>
			) : null}
		</>
	);
}

function ChatFileLink({
	fileTarget,
	linkContext,
	parentSuffix,
	requiresWorkspaceFile = false,
	children,
	...props
}: FileMarkdownLinkProps<ChatFileLinkContext>) {
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
		<ResolvableFileLinkChip
			{...props}
			children={children}
			fileTarget={fileTarget}
			linkContext={linkContext}
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
