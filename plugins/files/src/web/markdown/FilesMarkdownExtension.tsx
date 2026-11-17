import {
	QueryClientProvider,
	useQuery,
	useQueryClient,
	type QueryClient,
} from "@tanstack/react-query";
import { createContext, useContext, useState, type ComponentType } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type {
	ChatMarkdownContext,
	MarkdownExtensionImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import type { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { absoluteFilePath } from "../../contracts/panes.js";
import { openFile } from "../../shared/open-file.js";
import { documentsUnavailable, type DocumentsHandle } from "../documents.js";
import { FileLinkCandidatesDialog } from "./FileLinkCandidatesDialog.js";
import { FileLinkChip, type FileLinkChipProps } from "./FileLinkChip.js";
import {
	createFileMarkdownExtension,
	type FileMarkdownLinkProps,
	type UnresolvedInlineCodeProps,
} from "./file-markdown-extension.js";
import {
	resolveMarkdownFileLink,
	type MarkdownFileLinkTarget,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";
import { FileExistenceBatcher } from "./file-existence-batcher.js";

export interface FileLinksRuntime {
	readonly queries: QueryClient;
	readonly documents: () => DocumentsHandle | null;
	readonly panes: () => DomainObjectHandle<typeof Panes> | null;
}

interface FileLinksServices extends FileLinksRuntime {
	readonly existence: FileExistenceBatcher;
}

const FileLinksContext = createContext<FileLinksServices | null>(null);

function useFileLinks(): FileLinksServices {
	const services = useContext(FileLinksContext);
	if (!services) throw new Error("File links render inside kilo.files' markdown extension.");
	return services;
}

interface ChatFileLinkContext extends ChatMarkdownContext {
	readonly primaryWorkspace: MarkdownFileWorkspaceFolder | undefined;
}

function useWorkspaceFileExists(fileTarget: MarkdownFileLinkTarget | null): boolean {
	const { existence } = useFileLinks();
	const query = useQuery({
		queryKey: [
			"kilo.files",
			"file-exists",
			fileTarget?.workspaceDirectory,
			fileTarget?.relativePath,
		],
		queryFn: () =>
			fileTarget
				? existence.exists(fileTarget.workspaceDirectory, fileTarget.relativePath)
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
	const { documents, panes: panesOf } = useFileLinks();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	const [candidates, setCandidates] = useState<readonly string[]>([]);

	const openResolvedFile = (relativePath: string) => {
		const panes = panesOf();
		if (!panes) return;
		void openFile(panes, {
			workSessionId: linkContext.workSessionId,
			path: absoluteFilePath(fileTarget.workspaceDirectory, relativePath),
			line: fileTarget.line,
			column: fileTarget.column,
		}).catch(() => toast.error(`Could not open ${relativePath}.`));
	};

	const resolveAndOpen = async () => {
		setPending(true);
		await queryClient
			.fetchQuery({
				queryKey: [
					"kilo.files",
					"resolve-file-link",
					fileTarget.workspaceDirectory,
					fileTarget.relativePath,
				],
				queryFn: () =>
					documents()?.methods.resolveFileLink({
						workspaceDirectory: fileTarget.workspaceDirectory,
						relativePath: fileTarget.relativePath,
					}) ?? documentsUnavailable(),
				staleTime: RESOLVED_LINK_STALE_TIME_MS,
			})
			.then((resolution) => {
				const [onlyPath] = resolution.paths;
				if (resolution.paths.length === 1 && onlyPath !== undefined) {
					openResolvedFile(onlyPath);
				} else if (resolution.paths.length > 1) {
					setCandidates(resolution.paths);
				} else {
					toast.error(notFoundMessage(fileTarget.relativePath, resolution.truncated));
				}
			})
			.catch(() => {
				toast.error(`Could not open ${fileTarget.relativePath}.`);
			})
			.finally(() => setPending(false));
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

function FileLinksBoundary<P extends object>({
	services,
	component: Component,
	componentProps,
}: {
	readonly services: FileLinksServices;
	readonly component: ComponentType<P>;
	readonly componentProps: P;
}) {
	return (
		<QueryClientProvider client={services.queries}>
			<FileLinksContext.Provider value={services}>
				<Component {...componentProps} />
			</FileLinksContext.Provider>
		</QueryClientProvider>
	);
}

function withFileLinks<P extends object>(
	services: FileLinksServices,
	Component: ComponentType<P>,
): ComponentType<P> {
	return (props: P) => (
		<FileLinksBoundary services={services} component={Component} componentProps={props} />
	);
}

/**
 * kilo.files' `markdown-extension`: workspace file references in the agent's
 * replies become file chips that open in the session through kilo.work-sessions'
 * openers. The chips render in kilo.chat's transcript, so they bring
 * kilo.files' own query cache and domain handles; existence checks from every
 * chip share one batcher.
 */
export function createFilesMarkdownExtension(
	runtime: FileLinksRuntime,
): MarkdownExtensionImplementation {
	const services: FileLinksServices = {
		...runtime,
		existence: new FileExistenceBatcher(
			(input) => runtime.documents()?.methods.existingPaths(input) ?? documentsUnavailable(),
		),
	};
	const Link = withFileLinks(services, ChatFileLink);
	const UnresolvedInlineCode = withFileLinks(services, WorkspaceBareFileLink);
	return (context) => {
		const primaryWorkspace =
			context.workspaceFolders.find((folder) => folder.isPrimary) ?? context.workspaceFolders[0];
		return createFileMarkdownExtension({
			workspaceFolders: context.workspaceFolders,
			linkifyPlainText: true,
			linkContext: { ...context, primaryWorkspace },
			Link,
			UnresolvedInlineCode,
		});
	};
}
