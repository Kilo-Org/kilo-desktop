/** Typing grows the docked composer up to this share of its chat pane. */
export const NATURAL_RATIO = 0.5;
/** Dragging the top edge can raise the composer up to this share of the pane. */
export const MAX_DRAG_RATIO = 0.7;

const KEYBOARD_STEP = 0.02;
const KEYBOARD_STEP_LARGE = 0.05;

/** The thread root publishes its height as `--thread-height` (see `thread.tsx`). */
export function paneShare(ratio: number): string {
	return `calc(var(--thread-height, 16rem) * ${ratio})`;
}

/** True when the content fills the natural cap, so the input has stopped growing. */
export function fillsNaturalCap(contentHeight: number, paneHeight: number): boolean {
	return paneHeight > 0 && contentHeight >= Math.floor(paneHeight * NATURAL_RATIO);
}

export function clampDragRatio(ratio: number): number {
	return Math.min(MAX_DRAG_RATIO, Math.max(NATURAL_RATIO, ratio));
}

/** Ratio for a drag that started at `startHeight`; moving the pointer up grows the input. */
export function dragRatioFromPointer(
	startHeight: number,
	deltaY: number,
	paneHeight: number,
): number {
	if (paneHeight <= 0) return NATURAL_RATIO;
	return clampDragRatio((startHeight - deltaY) / paneHeight);
}

export function stepDragRatio(ratio: number, direction: 1 | -1, large: boolean): number {
	const step = large ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
	return clampDragRatio(Math.round((ratio + direction * step) * 1000) / 1000);
}
