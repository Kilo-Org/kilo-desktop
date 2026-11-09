import type { QueryClient } from "@tanstack/react-query";
import { FileIcon } from "lucide-react";

import type {
	ComposerMentionImplementation,
	IconComponent,
	MentionItem,
	MentionSearchContext,
} from "@kilo-desktop/plugin-chat/contracts";

import type { DocumentsHandle } from "../documents.js";
import { PierreFileIcon } from "../file-icons/PierreFileIcon.js";
import {
	fileMentionFormatter,
	fileMentionItems,
	workspaceFileMentionItems,
	type FileMentionItem,
} from "./file-mention.js";

const LIST_STALE_TIME_MS = 30_000;
const LIST_GC_TIME_MS = 5 * 60_000;

function mentionDirectories(context: Omit<MentionSearchContext, "signal">): string[] {
	if (context.workspaceFolders.length > 0) return context.workspaceFolders.map(({ path }) => path);
	return context.directory ? [context.directory] : [];
}

const icons = new Map<string, IconComponent>();

/** A file-type icon for one path, made once per path so lists keep stable components. */
function iconFor(path: string): IconComponent {
	let icon = icons.get(path);
	if (!icon) {
		icon = function FileMentionIcon({ className }) {
			return <PierreFileIcon className={className ?? "size-3.5 shrink-0"} path={path} />;
		};
		icons.set(path, icon);
	}
	return icon;
}

function toMentionItem(item: FileMentionItem): MentionItem {
	return { id: item.id, label: item.label, detail: item.description, icon: iconFor(item.id) };
}

/**
 * kilo.files' `@` mention source (origin's composer trigger): `search` lists
 * the files of the composer's workspace folders (cached per folder for 30 s)
 * filtered by path, and a chosen file resolves to origin's `@/path` text —
 * relative to the folder for a single-folder workspace, absolute otherwise.
 */
export function createFileMentionSource(
	queries: QueryClient,
	documents: () => DocumentsHandle | null,
): ComposerMentionImplementation {
	const list = (workspaceDirectory: string) =>
		queries.fetchQuery({
			queryKey: ["kilo.files", "file-mentions", workspaceDirectory],
			queryFn: async () => {
				const handle = documents();
				if (!handle) return { paths: [], truncated: false };
				return handle.methods.list({ workspaceDirectory });
			},
			staleTime: LIST_STALE_TIME_MS,
			gcTime: LIST_GC_TIME_MS,
		});

	return {
		icon: FileIcon,
		async search(query, context) {
			const directories = mentionDirectories(context);
			if (directories.length === 0) return [];
			const lists = await Promise.all(
				directories.map(async (directory) => ({
					workspaceDirectory: directory,
					paths: (await list(directory).catch(() => ({ paths: [] }))).paths,
				})),
			);
			const items =
				lists.length === 1 ? fileMentionItems(lists[0]!.paths) : workspaceFileMentionItems(lists);
			const normalized = query.toLocaleLowerCase();
			return items
				.filter((item) => item.id.toLocaleLowerCase().includes(normalized))
				.map(toMentionItem);
		},
		resolve(item) {
			return { text: fileMentionFormatter.serialize(item).trimEnd() };
		},
	};
}
