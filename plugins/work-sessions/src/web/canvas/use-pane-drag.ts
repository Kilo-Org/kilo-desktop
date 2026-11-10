import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { PaneDrop } from "./pane-drop";
import {
	capturePaneDragSource,
	resolvePaneDrop,
	type ActivePaneDrop,
	type PaneDragSource,
} from "./pane-drag-target";
import {
	clearPaneDrop,
	createPaneDragGhost,
	movePaneDragGhost,
	showPaneDrop,
} from "./pane-drag-preview";

type DropHandlers = {
	canDrop?: ((drop: PaneDrop) => boolean) | undefined;
	onDrop?: ((drop: PaneDrop) => void) | undefined;
};
type Drag = {
	origin: PaneDragSource;
	pointerId: number;
	startX: number;
	startY: number;
	capture: HTMLElement;
	ghost?: HTMLElement;
	active?: ActivePaneDrop;
	scrollFrame?: number;
};

/* The hook owns pointer capture, cancellation, and scrolling for one drag. Target
 * resolution only reads geometry; preview rendering owns reversible DOM changes.
 * Layout changes commit once on drop, so previews never remount pane content.
 * Every cancellation path removes the preview and releases capture and timers.
 */
export function usePaneDrag({ onDrop, canDrop }: DropHandlers) {
	const stripRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<Drag | null>(null);
	const suppressClickRef = useRef<Pick<PaneDrop, "kind" | "sourceId"> | null>(null);

	const clearMarker = useCallback(() => {
		const drag = dragRef.current;
		if (!drag) return;
		clearPaneDrop(drag.origin, drag.active);
		delete drag.active;
	}, []);

	const cleanup = useCallback(() => {
		const drag = dragRef.current;
		if (!drag) return;
		clearMarker();
		if (drag.scrollFrame !== undefined) cancelAnimationFrame(drag.scrollFrame);
		dragRef.current = null;
		drag.ghost?.remove();
		delete drag.origin.source.dataset.dragging;
		delete drag.origin.canvas.dataset.paneDragging;
		if (drag.capture.hasPointerCapture(drag.pointerId))
			drag.capture.releasePointerCapture(drag.pointerId);
		if (drag.ghost)
			suppressClickRef.current = { kind: drag.origin.kind, sourceId: drag.origin.sourceId };
	}, [clearMarker]);

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

	const startPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, kind: PaneDrop["kind"], sourceId: string) => {
			if (event.button !== 0 || !onDrop) return;
			const canvas = stripRef.current?.closest<HTMLElement>("[data-qa-id='kilo-chat-pane-canvas']");
			const source = event.currentTarget.closest<HTMLElement>(
				kind === "pane" ? "[data-pane-tab]" : "[data-pane-group-id]",
			);
			if (!canvas || !source) return;
			cleanup();
			suppressClickRef.current = null;
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragRef.current = {
				origin: capturePaneDragSource(kind, sourceId, source, canvas),
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				capture: event.currentTarget,
			};
		},
		[cleanup, onDrop],
	);

	const onPointerDrag = useCallback(
		function movePointer(
			event: Pick<
				ReactPointerEvent<HTMLElement>,
				"pointerId" | "clientX" | "clientY" | "preventDefault"
			>,
			scrolling = false,
		) {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			if (drag.scrollFrame !== undefined) cancelAnimationFrame(drag.scrollFrame);
			if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5)
				return;
			event.preventDefault();
			if (!drag.ghost) {
				drag.ghost = createPaneDragGhost(drag.origin);
				drag.origin.source.dataset.dragging = "true";
				drag.origin.canvas.dataset.paneDragging = "true";
			}
			const point = { x: event.clientX, y: event.clientY };
			movePaneDragGhost(drag.ghost, point);
			const result = resolvePaneDrop(drag.origin, drag.active, point, scrolling);
			if (result.scroll) {
				const { element, direction } = result.scroll;
				drag.scrollFrame = requestAnimationFrame(() => {
					const previous = element.scrollLeft;
					element.scrollLeft += direction * 8;
					if (element.scrollLeft !== previous) movePointer(event, true);
				});
			}
			if (result.action === "keep") {
				if (result.refreshPoint && drag.active) drag.active.lastPoint = point;
				return;
			}
			clearMarker();
			if (result.action === "show" && (canDrop?.(result.target.drop) ?? true)) {
				drag.active = showPaneDrop(drag.origin, result.target, drag.ghost, point);
			}
		},
		[clearMarker, canDrop],
	);

	const finishPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			const drop = drag.active?.target.drop;
			cleanup();
			if (!cancelled && drop) onDrop?.(drop);
		},
		[cleanup, onDrop],
	);

	return { stripRef, suppressClickRef, startPointerDrag, onPointerDrag, finishPointerDrag };
}
