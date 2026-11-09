export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** Content scaled by `scale` with its top-left corner at (`x`, `y`) in viewport pixels. */
export interface View {
	readonly scale: number;
	readonly x: number;
	readonly y: number;
}

export const MAX_ZOOM = 8;
const MIN_ZOOM_OF_FIT = 1 / 4;
const WHEEL_STEP_CAP = 24;
const WHEEL_SENSITIVITY = 0.02;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

/** The scale that shows all of `content` inside `viewport`, enlarging at most to `maxFit`. */
export function fitScale(content: Size, viewport: Size, maxFit = 1): number {
	if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
		return 1;
	}
	return Math.min(viewport.width / content.width, viewport.height / content.height, maxFit);
}

export function clampScale(scale: number, fit: number): number {
	return Math.min(Math.max(scale, fit * MIN_ZOOM_OF_FIT), Math.max(MAX_ZOOM, fit));
}

export function centeredView(content: Size, viewport: Size, scale: number): View {
	return {
		scale,
		x: (viewport.width - content.width * scale) / 2,
		y: (viewport.height - content.height * scale) / 2,
	};
}

export function zoomViewAt(view: View, scale: number, anchor: Point): View {
	const ratio = scale / view.scale;
	return {
		scale,
		x: anchor.x - (anchor.x - view.x) * ratio,
		y: anchor.y - (anchor.y - view.y) * ratio,
	};
}

export function panView(view: View, dx: number, dy: number): View {
	return { scale: view.scale, x: view.x + dx, y: view.y + dy };
}

function constrainAxis(position: number, contentLength: number, viewportLength: number): number {
	if (contentLength <= viewportLength) return (viewportLength - contentLength) / 2;
	return Math.min(0, Math.max(viewportLength - contentLength, position));
}

/**
 * Centers an axis whose scaled content fits the viewport; otherwise keeps the
 * content covering both edges so a pan never strands it off screen.
 */
export function constrainView(view: View, content: Size, viewport: Size): View {
	return {
		scale: view.scale,
		x: constrainAxis(view.x, content.width * view.scale, viewport.width),
		y: constrainAxis(view.y, content.height * view.scale, viewport.height),
	};
}

/**
 * The zoom factor for one wheel event. Mouse notches (large deltas) are capped
 * so each feels like one step; trackpad pinches (small deltas) zoom smoothly.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
	const pixels =
		deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * PAGE_HEIGHT_PX : deltaY;
	const step = Math.min(Math.max(-pixels, -WHEEL_STEP_CAP), WHEEL_STEP_CAP);
	return 2 ** (step * WHEEL_SENSITIVITY);
}
