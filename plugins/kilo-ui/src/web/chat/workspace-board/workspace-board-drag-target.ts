const SCROLL_EDGE = 28;

export type DragPoint = { x: number; y: number };

export type BoardDragItem =
	| { kind: "sidebar" | "card"; sessionId: string; title: string }
	| { kind: "column"; columnId: string; title: string; detail: string };

export type BoardDrop =
	| { kind: "session"; sessionId: string; columnId: string; index: number }
	| { kind: "column"; columnId: string; index: number };

/** Where a chat would land: its column and its index among the other cards there. */
export type BoardDropTarget = {
	columnId: string;
	index: number;
	column: HTMLElement;
	list: HTMLElement;
	/** The card the preview is inserted before; null appends. */
	before: HTMLElement | null;
};

/** Where a dragged column would land among the other columns. */
export type ColumnDropTarget = {
	index: number;
	container: HTMLElement;
	/** The column the preview is inserted before; null places it after `last`. */
	before: HTMLElement | null;
	last: HTMLElement | null;
};

/**
 * Items are spans along one axis in visual order; the pointer goes before the
 * first item whose middle is past it.
 */
export function insertionIndex(
	items: readonly { start: number; size: number }[],
	position: number,
): number {
	return items.filter((item) => item.start + item.size / 2 < position).length;
}

export function edgeScrollDirection(start: number, end: number, position: number): -1 | 0 | 1 {
	if (position < start || position > end) return 0;
	if (position < start + SCROLL_EDGE) return -1;
	if (position > end - SCROLL_EDGE) return 1;
	return 0;
}

/**
 * Reads live geometry only. The dragged card is excluded so indexes match the
 * board once it is removed from its old position; the drop preview is
 * pointer-transparent and skipped, so it never shifts the answer.
 */
export function resolveBoardDropTarget(
	board: HTMLElement,
	point: DragPoint,
	sessionId: string,
): BoardDropTarget | null {
	const hit = document.elementFromPoint(point.x, point.y);
	const hitColumn = hit?.closest<HTMLElement>("[data-workspace-board-column]");
	const column = hitColumn && board.contains(hitColumn) ? hitColumn : columnInLane(board, point);
	if (!column) return null;
	const list = column.querySelector<HTMLElement>("[data-workspace-board-cards]");
	if (!list) return null;
	const cards = [...list.querySelectorAll<HTMLElement>("[data-workspace-board-card]")].filter(
		(card) => card.dataset.sessionId !== sessionId,
	);
	const index = insertionIndex(
		cards.map((card) => {
			const rect = card.getBoundingClientRect();
			return { start: rect.top, size: rect.height };
		}),
		point.y,
	);
	return { columnId: column.dataset.columnId!, index, column, list, before: cards[index] ?? null };
}

/**
 * Columns are only as tall as their cards, so the empty board below a column
 * still drops into it, at the end.
 */
function columnInLane(board: HTMLElement, point: DragPoint): HTMLElement | null {
	const strip = board.querySelector<HTMLElement>("[data-workspace-board-columns]");
	if (!strip) return null;
	// Inside the strip on both axes: columns scrolled out of view still have
	// rects, under the sidebar or past the right edge.
	const bounds = strip.getBoundingClientRect();
	const inside =
		point.x >= bounds.left &&
		point.x <= bounds.right &&
		point.y >= bounds.top &&
		point.y <= bounds.bottom;
	if (!inside) return null;
	return (
		[...strip.querySelectorAll<HTMLElement>(":scope > [data-workspace-board-column]")].find(
			(column) => {
				const rect = column.getBoundingClientRect();
				return point.x >= rect.left && point.x <= rect.right;
			},
		) ?? null
	);
}

/** Columns reorder anywhere over the column strip; the dragged column is excluded. */
export function resolveColumnDropTarget(
	board: HTMLElement,
	point: DragPoint,
	columnId: string,
): ColumnDropTarget | null {
	const container = board.querySelector<HTMLElement>("[data-workspace-board-columns]");
	if (!container) return null;
	const rect = container.getBoundingClientRect();
	const inside =
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
	if (!inside) return null;
	const columns = [
		...container.querySelectorAll<HTMLElement>(":scope > [data-workspace-board-column]"),
	].filter((column) => column.dataset.columnId !== columnId);
	const index = insertionIndex(
		columns.map((column) => {
			const bounds = column.getBoundingClientRect();
			return { start: bounds.left, size: bounds.width };
		}),
		point.x,
	);
	return { index, container, before: columns[index] ?? null, last: columns.at(-1) ?? null };
}

/**
 * The scroller that should follow the pointer: the hovered column's cards, then
 * the column strip. A scroller already at its end in that direction is skipped,
 * so being near the top of a column never blocks scrolling the board sideways.
 */
export function resolveBoardScroll(
	board: HTMLElement,
	point: DragPoint,
	target: BoardDropTarget | null,
): { element: HTMLElement; axis: "x" | "y"; direction: -1 | 1 } | null {
	const cards = target?.column.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
	if (cards) {
		const rect = cards.getBoundingClientRect();
		const direction = edgeScrollDirection(rect.top, rect.bottom, point.y);
		if (direction && canScroll(cards, "y", direction)) {
			return { element: cards, axis: "y", direction };
		}
	}
	const columns = board.querySelector<HTMLElement>("[data-workspace-board-columns]");
	if (columns) {
		const rect = columns.getBoundingClientRect();
		const inside = point.y >= rect.top && point.y <= rect.bottom;
		const direction = inside ? edgeScrollDirection(rect.left, rect.right, point.x) : 0;
		if (direction && canScroll(columns, "x", direction)) {
			return { element: columns, axis: "x", direction };
		}
	}
	return null;
}

function canScroll(element: HTMLElement, axis: "x" | "y", direction: -1 | 1): boolean {
	const position = axis === "x" ? element.scrollLeft : element.scrollTop;
	const max =
		axis === "x"
			? element.scrollWidth - element.clientWidth
			: element.scrollHeight - element.clientHeight;
	return direction < 0 ? position > 0 : position < max;
}
