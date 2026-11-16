import type { ActivePaneDrop, DragPoint, PaneDragSource, PaneDropTarget } from "./pane-drag-target";

export function createPaneDragGhost(drag: PaneDragSource) {
	const tab =
		drag.kind === "pane"
			? drag.source
			: (drag.source.querySelector<HTMLElement>(
					`[data-pane-tab="${CSS.escape(drag.source.dataset.paneId ?? "")}"]`,
				) ?? drag.source.querySelector<HTMLElement>("[data-pane-tab]"));
	const ghost = document.createElement("div");
	ghost.className = "pane-drag-ghost";
	ghost.dataset.qaId = "chat-pane-drag-preview";
	ghost.setAttribute("aria-hidden", "true");
	ghost.inert = true;
	const icon = tab?.querySelector("svg");
	if (icon) ghost.append(icon.cloneNode(true));
	const label = document.createElement("span");
	label.textContent = tab?.querySelector("[role=tab]")?.textContent ?? "Pane group";
	ghost.append(label);
	if (drag.kind === "group") {
		const count = document.createElement("small");
		count.textContent = `${drag.source.querySelectorAll("[data-pane-tab]").length} tabs`;
		ghost.append(count);
	}
	document.body.append(ghost);
	return ghost;
}

export function movePaneDragGhost(ghost: HTMLElement, point: DragPoint) {
	const ghostX = Math.max(8, Math.min(point.x + 14, window.innerWidth - ghost.offsetWidth - 8));
	const ghostY = Math.max(8, Math.min(point.y + 14, window.innerHeight - ghost.offsetHeight - 8));
	ghost.style.transform = `translate3d(${ghostX}px, ${ghostY}px, 0) rotate(-2deg)`;
}

export function clearPaneDrop(drag: PaneDragSource, active: ActivePaneDrop | undefined) {
	if (!active) return;
	const { element, neighbors } = active.target;
	delete element.dataset.dropZone;
	element.style.removeProperty("--pane-drop-space");
	element.style.removeProperty("--pane-neighbor-space");
	element.style.removeProperty("--pane-boundary-gap");
	for (const neighbor of neighbors) {
		delete neighbor.element.dataset.dropNeighbor;
		neighbor.element.style.removeProperty("--pane-drop-space");
	}
	delete drag.source.dataset.tabReordering;
	active.preview.remove();
}

export function showPaneDrop(
	drag: PaneDragSource,
	target: PaneDropTarget,
	ghost: HTMLElement,
	point: DragPoint,
): ActivePaneDrop {
	const { element, space, neighbors, boundary, stack } = target;
	const { position } = target.drop;
	const isTab = target.drop.targetKind === "tab";
	element.dataset.dropZone = position;
	if (target.reorderSource) drag.source.dataset.tabReordering = "true";
	element.style.setProperty("--pane-drop-space", `${space}px`);
	for (const neighbor of neighbors) {
		neighbor.element.dataset.dropNeighbor = neighbor.position;
		neighbor.element.style.setProperty("--pane-drop-space", `${neighbor.space}px`);
	}
	if (boundary) {
		element.style.setProperty("--pane-neighbor-space", `${boundary.space}px`);
		element.style.setProperty("--pane-boundary-gap", `${boundary.gap}px`);
	}
	const preview = document.createElement("div");
	preview.className = "pane-drop-preview";
	if (stack) {
		preview.style.top = `${stack.top}px`;
		preview.style.bottom = "auto";
		preview.style.height = `${stack.height}px`;
	}
	preview.dataset.qaId = "chat-pane-drop-preview";
	preview.setAttribute("aria-hidden", "true");
	preview.inert = true;
	const title = document.createElement("span");
	title.textContent = ghost.querySelector("span")?.textContent ?? "Pane";
	preview.append(title);
	if (!isTab) {
		const hint = document.createElement("small");
		hint.textContent = position === "inside" ? "Add to tab group" : "Split here";
		preview.append(hint);
	}
	if (isTab) {
		const icon = ghost.querySelector("svg");
		if (icon) preview.prepend(icon.cloneNode(true));
		preview.classList.add("pane-tab-drop-preview");
		preview.style.width = `${space}px`;
		element.insertAdjacentElement(position === "before" ? "beforebegin" : "afterend", preview);
	} else {
		element.append(preview);
	}
	return { target, preview, lastPoint: point };
}
