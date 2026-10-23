import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";

import {
	resolveBoardDropTarget,
	resolveBoardScroll,
	resolveColumnDropTarget,
	type BoardDragItem,
	type BoardDrop,
	type DragPoint,
} from "./workspace-board-drag-target.js";
import { movePaneDragGhost } from "../pane-canvas/pane-drag-preview.js";
import {
	clearBoardDrop,
	createBoardDragGhost,
	isSameDrop,
	showColumnDrop,
	showSessionDrop,
	type ActiveBoardDrop,
	type BoardDragSource,
} from "./workspace-board-drag-preview.js";

const DRAG_THRESHOLD = 5;
/** Height of a two-row card, which a chat dragged from the sidebar becomes. */
const SIDEBAR_DROP_HEIGHT = 60;

type Drag = {
	source: BoardDragSource;
	pointerId: number;
	startX: number;
	startY: number;
	board?: HTMLElement;
	ghost?: HTMLElement;
	active?: ActiveBoardDrop;
	scrollFrame?: number;
};

/**
 * Mirrors the pane canvas drag (use-pane-drag.ts): the hook owns one pointer drag,
 * its cancellation and edge scrolling; target resolution only reads geometry; the
 * preview module owns reversible DOM changes; the board commits once on drop, so
 * React never re-renders mid-drag. It drags chats (from the sidebar or a card) into
 * columns, and columns along the board. A chat drag can start in the sidebar and
 * end on the board page, so moves are followed on the window and pointer capture
 * is only a best effort (the virtualized sidebar may unmount the row). Every
 * cancellation path removes the preview and listeners.
 *
 * On a drop the preview outlives the pointer: the store's optimistic update reaches
 * React a task later (TanStack Query batches notifications), so clearing the preview
 * at once would paint a frame with the old order. It is cleared in the layout effect
 * of the render that commits the new board, or after two frames if nothing changed.
 */
export function useWorkspaceBoardDrag(onDrop: (drop: BoardDrop) => void) {
	const dragRef = useRef<Drag | null>(null);
	const onDropRef = useRef(onDrop);
	onDropRef.current = onDrop;
	const listenersRef = useRef<{ detach: () => void } | null>(null);
	const droppedRef = useRef<Drag | null>(null);

	const releasePointer = useCallback((drag: Drag) => {
		listenersRef.current?.detach();
		listenersRef.current = null;
		if (drag.scrollFrame !== undefined) cancelAnimationFrame(drag.scrollFrame);
		drag.ghost?.remove();
		delete document.documentElement.dataset.paneDragging;
		if (drag.source.element.hasPointerCapture?.(drag.pointerId)) {
			drag.source.element.releasePointerCapture(drag.pointerId);
		}
		if (drag.ghost) suppressNextClick();
	}, []);

	const settleDrop = useCallback(() => {
		const drag = droppedRef.current;
		if (!drag) return;
		droppedRef.current = null;
		clearDragVisuals(drag);
	}, []);

	const cleanup = useCallback(() => {
		settleDrop();
		const drag = dragRef.current;
		if (!drag) return;
		dragRef.current = null;
		releasePointer(drag);
		clearDragVisuals(drag);
	}, [releasePointer, settleDrop]);

	// No dependencies: any commit after a drop (normally the one carrying the new board) settles it.
	useLayoutEffect(() => {
		settleDrop();
	});

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && dragRef.current) {
				event.preventDefault();
				cleanup();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", cleanup);
		window.addEventListener("resize", cleanup);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", cleanup);
			window.removeEventListener("resize", cleanup);
			cleanup();
		};
	}, [cleanup]);

	const activate = useCallback(
		(drag: Drag) => {
			const board = document.querySelector<HTMLElement>("[data-workspace-board]");
			if (!board) {
				cleanup();
				return false;
			}
			drag.board = board;
			drag.ghost = createBoardDragGhost(drag.source);
			drag.source.element.dataset.dragging = "true";
			// The column preview stands in for the dragged column from the first move.
			if (drag.source.item.kind === "column") drag.source.element.dataset.boardReordering = "true";
			// Reuses the pane canvas rule: grabbing cursor and no text selection while dragging.
			document.documentElement.dataset.paneDragging = "true";
			try {
				drag.source.element.setPointerCapture(drag.pointerId);
			} catch {
				// Synthetic or already-released pointers cannot be captured; window listeners suffice.
			}
			return true;
		},
		[cleanup],
	);

	const move = useCallback(
		function movePointer(point: DragPoint, event?: PointerEvent) {
			const drag = dragRef.current;
			if (!drag) return;
			if (drag.scrollFrame !== undefined) cancelAnimationFrame(drag.scrollFrame);
			if (!drag.ghost) {
				if (Math.hypot(point.x - drag.startX, point.y - drag.startY) < DRAG_THRESHOLD) return;
				if (!activate(drag)) return;
			}
			event?.preventDefault();
			movePaneDragGhost(drag.ghost!, point);
			const resolved = resolveDrop(drag.board!, drag.source, point);
			if (resolved.scroll) {
				const { element, axis, direction } = resolved.scroll;
				drag.scrollFrame = requestAnimationFrame(() => {
					const key = axis === "x" ? "scrollLeft" : "scrollTop";
					const previous = element[key];
					element[key] += direction * 8;
					if (element[key] !== previous) movePointer(point);
				});
			}
			if (resolved.drop && isSameDrop(drag.active, resolved.drop)) return;
			clearBoardDrop(drag.source, drag.active);
			delete drag.active;
			if (resolved.drop) drag.active = resolved.show(resolved.drop);
		},
		[activate],
	);

	const finish = useCallback(
		(cancelled: boolean) => {
			const drag = dragRef.current;
			if (!drag) return;
			const drop = drag.active?.drop;
			if (cancelled || !drop) {
				cleanup();
				return;
			}
			dragRef.current = null;
			releasePointer(drag);
			droppedRef.current = drag;
			onDropRef.current(drop);
			requestAnimationFrame(() => requestAnimationFrame(settleDrop));
		},
		[cleanup, releasePointer, settleDrop],
	);

	const startDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, item: BoardDragItem) => {
			if (event.button !== 0) return;
			cleanup();
			// Columns drag by their header but move (and hide) as a whole.
			const element =
				item.kind === "column"
					? (event.currentTarget.closest<HTMLElement>("[data-workspace-board-column]") ??
						event.currentTarget)
					: event.currentTarget;
			const pointerId = event.pointerId;
			dragRef.current = {
				source: { item, element, size: dropSize(item, element) },
				pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
			const owns = (pointerEvent: PointerEvent) => pointerEvent.pointerId === pointerId;
			const onMove = (pointerEvent: PointerEvent) => {
				if (owns(pointerEvent)) {
					move({ x: pointerEvent.clientX, y: pointerEvent.clientY }, pointerEvent);
				}
			};
			const onUp = (pointerEvent: PointerEvent) => {
				if (owns(pointerEvent)) finish(false);
			};
			const onCancel = (pointerEvent: PointerEvent) => {
				if (owns(pointerEvent)) finish(true);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onCancel);
			listenersRef.current = {
				detach: () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onCancel);
				},
			};
		},
		[cleanup, finish, move],
	);

	return { startDrag };
}

function clearDragVisuals(drag: Drag) {
	clearBoardDrop(drag.source, drag.active);
	delete drag.source.element.dataset.dragging;
	delete drag.source.element.dataset.boardReordering;
}

function dropSize(item: BoardDragItem, element: HTMLElement) {
	if (item.kind === "sidebar") return { width: 0, height: SIDEBAR_DROP_HEIGHT };
	const { width, height } = element.getBoundingClientRect();
	return { width, height };
}

type ResolvedDrop = {
	drop: BoardDrop | null;
	show: (drop: BoardDrop) => ActiveBoardDrop;
	scroll: ReturnType<typeof resolveBoardScroll>;
};

function resolveDrop(board: HTMLElement, source: BoardDragSource, point: DragPoint): ResolvedDrop {
	const { item } = source;
	if (item.kind === "column") {
		const target = resolveColumnDropTarget(board, point, item.columnId);
		return {
			drop: target ? { kind: "column", columnId: item.columnId, index: target.index } : null,
			show: (drop) => showColumnDrop(source, target!, drop),
			scroll: resolveBoardScroll(board, point, null),
		};
	}
	const target = resolveBoardDropTarget(board, point, item.sessionId);
	return {
		drop: target
			? {
					kind: "session",
					sessionId: item.sessionId,
					columnId: target.columnId,
					index: target.index,
				}
			: null,
		show: (drop) => showSessionDrop(source, target!, drop),
		scroll: resolveBoardScroll(board, point, target),
	};
}

/** A drag ends with a click on its source; swallow it so dropping never opens the chat. */
function suppressNextClick() {
	const swallow = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	window.addEventListener("click", swallow, { capture: true, once: true });
	setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
