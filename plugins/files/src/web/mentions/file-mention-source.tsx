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
/** Rows the popover renders; it is not virtualized, so this bounds every keystroke's render. */
export const FILE_MENTION_RESULT_LIMIT = 50;

type FilesList = { readonly paths: readonly string[] };

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

/** A mention item with its lowercased name and shown path, prepared once per listing. */
interface Candidate {
	readonly item: FileMentionItem;
	readonly name: string;
	readonly path: string;
	readonly depth: number;
}

function toCandidate(item: FileMentionItem): Candidate {
	const path = item.description.toLocaleLowerCase();
	return {
		item,
		name: item.label.toLocaleLowerCase(),
		path,
		depth: path.split("/").length,
	};
}

/** Lower is better: exact name, name prefix, name substring, then anywhere in the path. */
function matchRank(candidate: Candidate, query: string): number | undefined {
	if (!query) return 0;
	const at = candidate.name.indexOf(query);
	if (at === 0) return candidate.name.length === query.length ? 0 : 1;
	if (at > 0) return 2;
	return candidate.path.includes(query) ? 3 : undefined;
}

/** Best matches first, shallower then shorter paths breaking ties, capped at `limit`. */
function rankFileMentions(
	candidates: readonly Candidate[],
	query: string,
	limit = FILE_MENTION_RESULT_LIMIT,
): FileMentionItem[] {
	const normalized = query.toLocaleLowerCase();
	const matches: { readonly candidate: Candidate; readonly rank: number }[] = [];
	for (const candidate of candidates) {
		const rank = matchRank(candidate, normalized);
		if (rank !== undefined) matches.push({ candidate, rank });
	}
	// Stable, so equal candidates keep main's sorted listing order.
	matches.sort(
		(left, right) =>
			left.rank - right.rank ||
			left.candidate.depth - right.candidate.depth ||
			left.candidate.path.length - right.candidate.path.length,
	);
	return matches.slice(0, limit).map(({ candidate }) => candidate.item);
}

function fileMentionCandidates(
	lists: readonly { readonly workspaceDirectory: string; readonly paths: readonly string[] }[],
): Candidate[] {
	const items =
		lists.length === 1 ? fileMentionItems(lists[0]!.paths) : workspaceFileMentionItems(lists);
	return items.map(toCandidate);
}

function toMentionItem(item: FileMentionItem): MentionItem {
	return { id: item.id, label: item.label, detail: item.description, icon: iconFor(item.id) };
}

/**
 * kilo.files' `@` mention source (origin's composer trigger): `search` ranks
 * the files of the composer's workspace folders — gitignored paths excluded,
 * listed in main and cached per folder (a stale list answers at once while it
 * refreshes) — and returns the best few, since the popover renders every row.
 * A chosen file resolves to origin's `@/path` text: relative to the folder for
 * a single-folder workspace, absolute otherwise.
 */
export function createFileMentionSource(
	queries: QueryClient,
	documents: () => DocumentsHandle | null,
): ComposerMentionImplementation {
	const list = (workspaceDirectory: string): Promise<FilesList> =>
		queries.ensureQueryData({
			queryKey: ["kilo.files", "file-mentions", workspaceDirectory],
			queryFn: async () => {
				const handle = documents();
				if (!handle) return { paths: [], truncated: false };
				return handle.methods.listFiles({ workspaceDirectory });
			},
			staleTime: LIST_STALE_TIME_MS,
			gcTime: LIST_GC_TIME_MS,
			revalidateIfStale: true,
		});

	// Lowercasing and item-building run once per listing, not once per keystroke.
	let prepared: { readonly lists: readonly FilesList[]; readonly candidates: Candidate[] } | null =
		null;
	const candidatesFor = (directories: readonly string[], lists: readonly FilesList[]) => {
		if (
			prepared?.lists.length === lists.length &&
			prepared.lists.every((cached, index) => cached === lists[index])
		) {
			return prepared.candidates;
		}
		const candidates = fileMentionCandidates(
			lists.map((listed, index) => ({
				workspaceDirectory: directories[index]!,
				paths: listed.paths,
			})),
		);
		prepared = { lists, candidates };
		return candidates;
	};

	return {
		icon: FileIcon,
		async search(query, context) {
			const directories = mentionDirectories(context);
			if (directories.length === 0) return [];
			const lists = await Promise.all(
				directories.map((directory) => list(directory).catch((): FilesList => ({ paths: [] }))),
			);
			if (context.signal.aborted) return [];
			return rankFileMentions(candidatesFor(directories, lists), query).map(toMentionItem);
		},
		resolve(item) {
			return { text: fileMentionFormatter.serialize(item).trimEnd() };
		},
	};
}
