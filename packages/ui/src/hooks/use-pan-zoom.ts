import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";

import {
	centeredView,
	clampScale,
	constrainView,
	fitScale,
	panView,
	wheelZoomFactor,
	zoomViewAt,
	type Point,
	type Size,
	type View,
} from "../lib/pan-zoom.js";
import { useLatestRef } from "./use-latest-ref.js";

export const ZOOM_STEP = 1.25;
const FIT_EPSILON = 0.001;

interface Geometry {
	readonly content: Size | null;
	readonly viewport: Size | null;
	readonly fit: number;
}

/**
 * Pan and zoom for one piece of content inside a viewport element.
 *
 * The view is derived, not stored: until the user zooms or pans, the content
 * sits centered at fit scale and follows viewport resizes. A user view is kept
 * only after an interaction and is re-constrained on every render, so resizes
 * never strand the content. `reset()` drops back to the derived fit view.
 * Operations use functional updates against a geometry ref, so bursts of wheel
 * events between renders compose instead of overwriting each other.
 */
export function usePanZoom({
	content,
	maxFit = 1,
	padding = 24,
}: {
	/** The content's natural size, or null until it is known. */
	readonly content: Size | null;
	/** How far fit may enlarge small content (vector content can go past 1). */
	readonly maxFit?: number;
	/** Breathing room around the content at fit scale. */
	readonly padding?: number;
}) {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [viewport, setViewport] = useState<Size | null>(null);
	const [userView, setUserView] = useState<View | null>(null);

	useEffect(() => {
		if (!element) return;
		const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);

	const fit =
		content && viewport
			? fitScale(
					content,
					{
						width: Math.max(1, viewport.width - padding * 2),
						height: Math.max(1, viewport.height - padding * 2),
					},
					maxFit,
				)
			: 1;
	const geometry = useLatestRef<Geometry>({ content, viewport, fit });

	const view: View | null =
		content && viewport
			? userView
				? constrainView(userView, content, viewport)
				: centeredView(content, viewport, fit)
			: null;

	const update = (change: (view: View, geometry: Geometry) => View) => {
		setUserView((previous) => {
			const { content, viewport, fit } = geometry.current;
			if (!content || !viewport) return previous;
			const current = previous
				? constrainView(previous, content, viewport)
				: centeredView(content, viewport, fit);
			return constrainView(change(current, geometry.current), content, viewport);
		});
	};

	const zoomTo = (scale: number, anchor?: Point) =>
		update((current, { viewport, fit }) =>
			zoomViewAt(
				current,
				clampScale(scale, fit),
				anchor ?? { x: (viewport?.width ?? 0) / 2, y: (viewport?.height ?? 0) / 2 },
			),
		);

	const zoomBy = (factor: number, anchor?: Point) =>
		update((current, { viewport, fit }) =>
			zoomViewAt(
				current,
				clampScale(current.scale * factor, fit),
				anchor ?? { x: (viewport?.width ?? 0) / 2, y: (viewport?.height ?? 0) / 2 },
			),
		);

	const panBy = (dx: number, dy: number) => update((current) => panView(current, dx, dy));

	const reset = () => setUserView(null);
	const zoomIn = () => zoomBy(ZOOM_STEP);
	const zoomOut = () => zoomBy(1 / ZOOM_STEP);
	const actualSize = () => zoomTo(1);

	const toLocal = (clientX: number, clientY: number): Point => {
		const rect = element?.getBoundingClientRect();
		return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
	};

	useEffect(() => {
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			if (event.deltaY !== 0) zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), anchor);
			else if (event.deltaX !== 0) panBy(-event.deltaX, 0);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [element, panBy, zoomBy]);

	const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		// Keep the drag from a surrounding pan surface (a pane carousel's track).
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// The pointer is already gone (or synthetic); the drag still tracks moves on the stage.
		}
		drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
		setDragging(true);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const start = drag.current;
		if (!start || start.pointerId !== event.pointerId) return;
		drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
		panBy(event.clientX - start.x, event.clientY - start.y);
	};

	const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	const isAtFit = !userView || Math.abs((view?.scale ?? fit) - fit) < FIT_EPSILON;

	/** At fit, zooms in on the clicked point; otherwise returns to fit. */
	const onDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
		event.preventDefault();
		if (isAtFit) zoomTo(Math.max(1, fit * 2), toLocal(event.clientX, event.clientY));
		else reset();
	};

	const contentStyle: CSSProperties =
		content && view
			? {
					position: "absolute",
					left: 0,
					top: 0,
					width: content.width,
					height: content.height,
					transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
					transformOrigin: "0 0",
				}
			: { position: "absolute", left: 0, top: 0, visibility: "hidden" };

	return {
		setViewportElement: setElement,
		view,
		fit,
		scale: view?.scale ?? fit,
		isAtFit,
		dragging,
		zoomIn,
		zoomOut,
		zoomBy,
		zoomTo,
		panBy,
		reset,
		actualSize,
		contentStyle,
		viewportHandlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp: endDrag,
			onPointerCancel: endDrag,
			onDoubleClick,
		},
	};
}
