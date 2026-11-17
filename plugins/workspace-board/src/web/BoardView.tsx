import {
	Fragment,
	useCallback,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type ReactNode,
} from "react";

import { useDomainObjectState, useDropTarget } from "@kilo-desktop/kernel/web";
import {
	WorkSessionObjectType,
	WorkSessions,
	Workspaces,
	type WorkSession,
	type WorkSessionRenderers,
	type WorkSessionsViewProps,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { ScrollArea } from "@kilo-desktop/ui/components/scroll-area";

import { BOARD_TELEMETRY_EVENTS } from "../contracts";
import { insertionIndex, resolveColumns, type BoardColumnView } from "./board-columns";
import { boardStore, useBoardState } from "./board-store";
import { BoardCard } from "./BoardCard";
import { BoardColumnHeader, COLUMN_DRAG_FORMAT, headingId } from "./BoardColumnHeader";
import { ClearBoardDialog } from "./ClearBoardDialog";
import { track } from "./telemetry";
import { columnToName, useSignal } from "./ui-state";

const NO_SESSIONS: readonly WorkSession[] = [];
const NO_WORKSPACES: readonly Workspace[] = [];
const selectSessions = (state: { workSessions: readonly WorkSession[] }) => state.workSessions;
const selectWorkspaces = (state: { workspaces: readonly Workspace[] }) => state.workspaces;

/**
 * The workspace board (kilo.work-sessions/work-sessions-view): fixed-width columns on
 * one row that scrolls sideways, each only as tall as its cards until it
 * reaches the board's height. Filtered by the session list's workspace focus
 * rather than a filter of its own: the list stays beside the board, which is
 * a second view of the same sessions. Columns take dropped sessions (cards
 * and session list rows) at the pointer, and reorder by their headers.
 */
export function BoardView({ focus, openWorkSession, detached, renderers }: WorkSessionsViewProps) {
	const board = useBoardState();
	const sessions = useDomainObjectState(WorkSessions, selectSessions) ?? NO_SESSIONS;
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const naming = useSignal(columnToName);
	const sessionsById = useMemo(
		() => new Map(sessions.map((session) => [session.id, session])),
		[sessions],
	);
	const columns = useMemo(
		() => resolveColumns(board, sessionsById, focus),
		[board, focus, sessionsById],
	);
	const reorder = useColumnReorder(columns);
	const onNamingStarted = useCallback(() => columnToName.set(null), []);

	return (
		<div data-qa-id="workspace-board" className="flex h-full min-h-0 flex-col">
			<div
				ref={reorder.stripRef}
				data-board-columns
				{...reorder.stripProps}
				// A size container, so columns can cap their cards at the strip's height (cqh).
				// Positioned, so absolute descendants (sr-only labels) in columns scrolled out of
				// view stay inside the scroller instead of widening the page.
				className="@container-size relative flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-2"
			>
				{columns.map((column, index) => (
					<Fragment key={column.id}>
						{reorder.previewIndex === index ? <ColumnDropPreview /> : null}
						<BoardColumn
							column={column}
							index={index}
							columnCount={columns.length}
							workspaces={workspaces}
							renderers={renderers}
							dragging={reorder.dragging === column.id}
							startNaming={naming === column.id}
							onNamingStarted={onNamingStarted}
							onOpen={openWorkSession}
							onColumnDragStart={() => reorder.start(column.id)}
							onColumnDragEnd={reorder.end}
						/>
					</Fragment>
				))}
				{reorder.previewIndex === columns.length ? <ColumnDropPreview /> : null}
			</div>
			{detached ? <ClearBoardDialog /> : null}
		</div>
	);
}

function ColumnDropPreview() {
	return (
		<div
			aria-hidden
			data-qa-id="workspace-board-column-drop-preview"
			className="border-primary-ink bg-card h-24 w-72 shrink-0 rounded-xl border-2 border-dashed"
		/>
	);
}

/** Columns reorder anywhere over the strip by dragging their headers. */
function useColumnReorder(columns: readonly BoardColumnView[]) {
	const stripRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState<string | null>(null);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const isColumnDrag = (event: DragEvent) => event.dataTransfer.types.includes(COLUMN_DRAG_FORMAT);
	const indexAt = (clientX: number, excluding: string | null) => {
		const strip = stripRef.current;
		if (!strip) return 0;
		const others = [...strip.querySelectorAll<HTMLElement>(":scope > [data-board-column]")].filter(
			(element) => element.dataset.columnId !== excluding,
		);
		return insertionIndex(
			others.map((element) => {
				const rect = element.getBoundingClientRect();
				return { start: rect.left, size: rect.width };
			}),
			clientX,
		);
	};
	/** Where the preview shows among all columns, for an index among the others. */
	const previewAt = (index: number) => {
		const from = columns.findIndex((column) => column.id === dragging);
		return from >= 0 && index >= from ? index + 1 : index;
	};
	const end = () => {
		setDragging(null);
		setPreviewIndex(null);
	};
	return {
		stripRef,
		dragging,
		previewIndex,
		start: (columnId: string) => setDragging(columnId),
		end,
		stripProps: {
			onDragOver: (event: DragEvent) => {
				if (!isColumnDrag(event)) return;
				event.preventDefault();
				setPreviewIndex(previewAt(indexAt(event.clientX, dragging)));
			},
			onDragLeave: (event: DragEvent) => {
				const next = event.relatedTarget;
				if (next instanceof Node && event.currentTarget.contains(next)) return;
				setPreviewIndex(null);
			},
			onDrop: (event: DragEvent) => {
				if (!isColumnDrag(event)) return;
				event.preventDefault();
				const columnId = event.dataTransfer.getData(COLUMN_DRAG_FORMAT);
				if (columnId) boardStore().moveColumn(columnId, indexAt(event.clientX, columnId));
				end();
			},
		},
	};
}

function BoardColumn({
	column,
	index,
	columnCount,
	workspaces,
	renderers,
	dragging,
	startNaming,
	onNamingStarted,
	onOpen,
	onColumnDragStart,
	onColumnDragEnd,
}: {
	readonly column: BoardColumnView;
	readonly index: number;
	readonly columnCount: number;
	readonly workspaces: readonly Workspace[];
	readonly renderers: WorkSessionRenderers;
	readonly dragging: boolean;
	readonly startNaming: boolean;
	readonly onNamingStarted: () => void;
	readonly onOpen: (sessionId: string) => void;
	readonly onColumnDragStart: () => void;
	readonly onColumnDragEnd: () => void;
}) {
	const listRef = useRef<HTMLOListElement>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	/** The index among the column's cards at the pointer, the dragged card left out. */
	const indexAt = (clientY: number, excluding?: string) => {
		const cards = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-board-card]") ?? [])];
		return insertionIndex(
			cards
				.filter((card) => card.dataset.sessionId !== excluding)
				.map((card) => {
					const rect = card.getBoundingClientRect();
					return { start: rect.top, size: rect.height };
				}),
			clientY,
		);
	};
	const drop = useDropTarget({
		accepts: [WorkSessionObjectType],
		onOver: (event) => setDropIndex(indexAt(event.clientY)),
		onLeave: () => setDropIndex(null),
		onDrop: (refs, event) => {
			const sessionId = refs[0]!.id;
			const shownIndex = indexAt(event.clientY, sessionId);
			boardStore().place(sessionId, column.id, savedIndex(column, shownIndex, sessionId));
			track(BOARD_TELEMETRY_EVENTS.placed, { source: "drag" });
		},
	});

	return (
		<section
			data-board-column
			data-column-id={column.id}
			data-drop-active={drop.isOver || undefined}
			role="group"
			aria-labelledby={headingId(column.id)}
			data-qa-id={`workspace-board-column-${column.id}`}
			{...drop.props}
			className="bg-foreground/3 data-[drop-active]:border-primary-ink data-[drop-active]:bg-primary/5 flex w-72 shrink-0 flex-col rounded-xl border border-transparent transition-[colors,opacity] data-[dragging]:opacity-40 data-[drop-active]:border-dashed"
			data-dragging={dragging || undefined}
		>
			<BoardColumnHeader
				column={column}
				index={index}
				columnCount={columnCount}
				startNaming={startNaming}
				onNamingStarted={onNamingStarted}
				onRename={(label) => boardStore().renameColumn(column.id, label)}
				onMove={(to) => boardStore().moveColumn(column.id, to)}
				onDelete={() => boardStore().deleteColumn(column.id)}
				onDragStart={onColumnDragStart}
				onDragEnd={onColumnDragEnd}
			/>
			{/* The viewport is capped at the strip's height less the header (h-10) and borders. */}
			<ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[calc(100cqh-(--spacing(10))-2px)]">
				<ol ref={listRef} className="flex flex-col gap-2 px-2 pt-1 pb-2">
					{column.cards.map((card, cardIndex) => (
						<CardSlot key={card.id} preview={dropIndex === cardIndex}>
							<BoardCard
								session={card}
								workspaces={workspaces}
								renderers={renderers}
								onOpen={onOpen}
							/>
						</CardSlot>
					))}
					{dropIndex !== null && dropIndex >= column.cards.length ? <CardDropPreview /> : null}
					{column.cards.length === 0 && dropIndex === null ? (
						<li className="text-muted-foreground flex h-15 list-none items-center justify-center rounded-xl border border-dashed text-xs">
							Drop sessions here
						</li>
					) : null}
				</ol>
			</ScrollArea>
		</section>
	);
}

function CardSlot({
	preview,
	children,
}: {
	readonly preview: boolean;
	readonly children: ReactNode;
}) {
	return (
		<>
			{preview ? <CardDropPreview /> : null}
			{children}
		</>
	);
}

function CardDropPreview() {
	return (
		<li
			aria-hidden
			data-qa-id="workspace-board-drop-preview"
			className="border-primary-ink bg-card h-15 shrink-0 list-none rounded-xl border-2 border-dashed"
		/>
	);
}

/**
 * The index among the column's saved cards for an index among those shown:
 * the focus may hide cards, so a drop lands after the shown card before it.
 */
export function savedIndex(column: BoardColumnView, shownIndex: number, sessionId: string): number {
	const shown = column.cards.filter((card) => card.id !== sessionId);
	if (shownIndex === 0) return 0;
	const before = shown[shownIndex - 1];
	if (!before) return Number.MAX_SAFE_INTEGER;
	const saved = boardStore()
		.snapshot()
		.columns.find((candidate) => candidate.id === column.id)
		?.sessionIds.filter((id) => id !== sessionId);
	const position = saved?.indexOf(before.id) ?? -1;
	return position >= 0 ? position + 1 : Number.MAX_SAFE_INTEGER;
}
