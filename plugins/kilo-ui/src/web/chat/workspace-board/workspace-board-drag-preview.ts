import "../pane-canvas/pane-drag.css";
import "./workspace-board-drag.css";

import type {
	BoardDragItem,
	BoardDrop,
	BoardDropTarget,
	ColumnDropTarget,
} from "./workspace-board-drag-target.js";

export type BoardDragSource = {
	item: BoardDragItem;
	element: HTMLElement;
	/**
	 * Size the drop preview reserves, measured at drag start (a dragged column is
	 * hidden by the time its preview shows): a card's height, or a column's box.
	 */
	size: { width: number; height: number };
};

export type ActiveBoardDrop = {
	drop: BoardDrop;
	preview: HTMLElement;
	/** Column highlighted as the target of a chat drop. */
	column?: HTMLElement;
};

/** Same ghost as dragged panes, so every drag in the chat UI looks alike. */
export function createBoardDragGhost(source: BoardDragSource) {
	const ghost = document.createElement("div");
	ghost.className = "pane-drag-ghost";
	ghost.dataset.qaId = "workspace-board-drag-preview";
	ghost.setAttribute("aria-hidden", "true");
	ghost.inert = true;
	// Only an icon the source marks for this; its first svg could be any action icon.
	const icon = source.element.querySelector("[data-board-drag-icon] svg");
	if (icon) ghost.append(icon.cloneNode(true));
	const label = document.createElement("span");
	label.textContent = source.item.title;
	ghost.append(label);
	if (source.item.kind === "column") {
		const detail = document.createElement("small");
		detail.textContent = source.item.detail;
		ghost.append(detail);
	}
	document.body.append(ghost);
	return ghost;
}

const dropKey = (drop: BoardDrop) =>
	drop.kind === "column" ? `column:${drop.index}` : `session:${drop.columnId}:${drop.index}`;

export function isSameDrop(active: ActiveBoardDrop | undefined, drop: BoardDrop) {
	return active !== undefined && dropKey(active.drop) === dropKey(drop);
}

function createPreview(tag: "div" | "li", className: string, qaId: string) {
	const preview = document.createElement(tag);
	preview.className = className;
	preview.dataset.qaId = qaId;
	preview.setAttribute("aria-hidden", "true");
	preview.inert = true;
	return preview;
}

export function showSessionDrop(
	source: BoardDragSource,
	target: BoardDropTarget,
	drop: BoardDrop,
): ActiveBoardDrop {
	const preview = createPreview(
		"li",
		"workspace-board-drop-preview",
		"workspace-board-drop-preview",
	);
	preview.style.setProperty("--workspace-board-card-drop-height", `${source.size.height}px`);
	target.list.insertBefore(preview, target.before);
	target.column.dataset.dropActive = "true";
	if (source.item.kind === "card" && target.column.contains(source.element)) {
		source.element.dataset.boardReordering = "true";
	}
	return { drop, preview, column: target.column };
}

export function showColumnDrop(
	source: BoardDragSource,
	target: ColumnDropTarget,
	drop: BoardDrop,
): ActiveBoardDrop {
	const preview = createPreview(
		"div",
		"workspace-board-column-drop-preview",
		"workspace-board-column-drop-preview",
	);
	preview.style.setProperty("--workspace-board-column-drop-width", `${source.size.width}px`);
	preview.style.setProperty("--workspace-board-column-drop-height", `${source.size.height}px`);
	const anchor = target.before ?? target.last?.nextSibling ?? target.container.firstChild;
	target.container.insertBefore(preview, anchor);
	return { drop, preview };
}

export function clearBoardDrop(source: BoardDragSource, active: ActiveBoardDrop | undefined) {
	if (!active) return;
	active.preview.remove();
	if (active.column) delete active.column.dataset.dropActive;
	// A dragged column stays hidden for the whole drag; a card only while its own column is the target.
	if (source.item.kind === "card") delete source.element.dataset.boardReordering;
}
