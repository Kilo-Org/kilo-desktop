import { useVirtualizer } from "@tanstack/react-virtual";
import { BookMarkedIcon, LockIcon, PlusIcon } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";

import { CommandItem, CommandList } from "@kilo-desktop/ui/components/command";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import type { GithubRepository } from "../../contracts";

/** cmdk value of the typed repository; the colon keeps it from colliding with an `owner/name`. */
export const TYPED_REPOSITORY_VALUE = "clone:typed-repository";

/** Rows are measured once drawn; this only sizes the ones not yet drawn. */
const ROW_HEIGHT_PX = 28;
/** Rows kept mounted past each edge, so arrowing off the visible ones reaches a mounted row. */
const OVERSCAN = 8;

type ListEntry =
	| { readonly kind: "heading"; readonly key: string; readonly label: string }
	| { readonly kind: "repository"; readonly key: string; readonly repository: GithubRepository }
	| { readonly kind: "typed"; readonly key: string };

/**
 * One row per owner heading and repository, owners in the order of their
 * most recent push (the list arrives newest push first), push order inside
 * each, then the typed repository when there is one.
 */
export function listEntries(
	repositories: readonly GithubRepository[],
	offerTyped: boolean,
): ListEntry[] {
	const groups = new Map<string, GithubRepository[]>();
	for (const candidate of repositories) {
		const owner = candidate.nameWithOwner.split("/")[0] ?? candidate.nameWithOwner;
		const group = groups.get(owner);
		if (group) group.push(candidate);
		else groups.set(owner, [candidate]);
	}
	const entries: ListEntry[] = [...groups].flatMap(([owner, owned]): ListEntry[] => [
		{ kind: "heading", key: `heading:${owner}`, label: owner },
		...owned.map((candidate): ListEntry => ({
			kind: "repository",
			key: candidate.nameWithOwner,
			repository: candidate,
		})),
	]);
	if (offerTyped) {
		entries.push(
			{ kind: "heading", key: "heading:typed", label: "Not in your list" },
			{ kind: "typed", key: TYPED_REPOSITORY_VALUE },
		);
	}
	return entries;
}

/**
 * Every repository, however many, drawn as cmdk items but only the rows in
 * view (plus overscan) mounted. cmdk moves the highlight among mounted rows;
 * `scrollToRef` is how the picker brings the highlighted one into view, which
 * mounts the rows beyond it.
 */
export function RepositoryList({
	entries,
	typed,
	verifying,
	placeholder,
	scrollToRef,
	onSelect,
	onSelectTyped,
}: {
	entries: readonly ListEntry[];
	typed: string;
	verifying: boolean;
	/** Shown in place of the rows: loading, or nothing to show. */
	placeholder: ReactNode;
	scrollToRef: RefObject<((value: string) => void) | null>;
	onSelect(repository: GithubRepository): void;
	onSelectTyped(): void;
}) {
	"use no memo"; // useVirtualizer mutates one instance in place; memoized readers would show stale rows.
	const listRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: entries.length,
		getScrollElement: () => listRef.current,
		estimateSize: () => ROW_HEIGHT_PX,
		overscan: OVERSCAN,
		getItemKey: (index) => entries[index]?.key ?? index,
	});
	scrollToRef.current = (value) => {
		const index = entries.findIndex((entry) => entry.key === value);
		if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
	};

	return (
		<CommandList
			ref={listRef}
			className="scroll-fade-y max-h-[calc(1.75rem*9)] scrollbar-thin"
			data-qa-id="github-repository-list"
		>
			{entries.length === 0 ? placeholder : null}
			<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
				{virtualizer.getVirtualItems().map((row) => {
					const entry = entries[row.index];
					if (!entry) return null;
					return (
						<div
							key={entry.key}
							data-index={row.index}
							ref={virtualizer.measureElement}
							className="absolute top-0 left-0 w-full"
							style={{ transform: `translateY(${row.start}px)` }}
						>
							<Row
								entry={entry}
								typed={typed}
								verifying={verifying}
								onSelect={onSelect}
								onSelectTyped={onSelectTyped}
							/>
						</div>
					);
				})}
			</div>
		</CommandList>
	);
}

function Row({
	entry,
	typed,
	verifying,
	onSelect,
	onSelectTyped,
}: {
	entry: ListEntry;
	typed: string;
	verifying: boolean;
	onSelect(repository: GithubRepository): void;
	onSelectTyped(): void;
}) {
	if (entry.kind === "heading") {
		return (
			// The look of a CommandGroup heading, so labels line up with items.
			<div
				role="presentation"
				className="text-muted-foreground truncate px-2 py-1.5 text-xs font-medium"
			>
				{entry.label}
			</div>
		);
	}
	if (entry.kind === "typed") {
		return (
			<CommandItem value={TYPED_REPOSITORY_VALUE} disabled={verifying} onSelect={onSelectTyped}>
				{verifying ? (
					<Spinner aria-hidden="true" />
				) : (
					<PlusIcon className="text-muted-foreground" aria-hidden="true" />
				)}
				<span className="min-w-0 flex-1 truncate">
					{verifying ? `Checking ${typed}…` : `Clone ${typed}`}
				</span>
			</CommandItem>
		);
	}
	const { repository } = entry;
	return (
		<CommandItem value={repository.nameWithOwner} onSelect={() => onSelect(repository)}>
			{repository.isPrivate ? (
				<LockIcon className="text-muted-foreground" aria-label="Private" />
			) : (
				<BookMarkedIcon className="text-muted-foreground" aria-hidden="true" />
			)}
			<span className="min-w-0 flex-1 truncate">{repository.name}</span>
			{repository.isArchived ? (
				<span className="text-muted-foreground text-xs">Archived</span>
			) : null}
		</CommandItem>
	);
}
