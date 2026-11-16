/**
 * Height of the docked composer input. Typing grows it up to NATURAL_RATIO of
 * the chat pane; once the text fills that, the top edge can be dragged to fix
 * the height anywhere up to MAX_DRAG_RATIO.
 *
 * The dragged height is a share of the pane, not pixels, so it follows pane
 * resizes through CSS without re-rendering. It is deliberately not persisted:
 * it resets as soon as the text no longer fills the natural cap, which also
 * covers sending (the composer clears). Fill is measured from the editable's
 * own height, which keeps tracking the text while the wrapper is clamped or
 * fixed; a ResizeObserver on it sees every content change.
 *
 * A fixed height can leave empty space under the text, so a click there
 * focuses the editor at the end, as a click below the last line would.
 */
import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";

import { NATURAL_RATIO, fillsNaturalCap, paneShare } from "./composer-height";

const THREAD_ROOT_SELECTOR = ".aui-thread-root";
const EDITABLE_SELECTOR = "[contenteditable]";

export interface ComposerDragStart {
	readonly inputHeight: number;
	readonly paneHeight: number;
}

export interface ComposerDragResize {
	/** The text fills the natural cap, so the edge can be dragged. */
	readonly canResize: boolean;
	/** Dragged share of the pane, or null while the input auto-sizes. */
	readonly ratio: number | null;
	readonly setRatio: (ratio: number | null) => void;
	readonly measureDragStart: () => ComposerDragStart | null;
	readonly inputStyle: CSSProperties | undefined;
}

function contentHeight(input: HTMLElement, editable: HTMLElement): number {
	const style = getComputedStyle(input);
	return (
		editable.offsetHeight +
		Number.parseFloat(style.paddingTop) +
		Number.parseFloat(style.paddingBottom)
	);
}

function focusEditorEnd(editable: HTMLElement): void {
	editable.focus({ preventScroll: true });
	const selection = editable.ownerDocument.getSelection();
	if (!selection) return;
	selection.selectAllChildren(editable);
	selection.collapseToEnd();
}

function inputStyleFor(enabled: boolean, ratio: number | null): CSSProperties | undefined {
	if (!enabled) return undefined;
	if (ratio === null) return { maxHeight: paneShare(NATURAL_RATIO) };
	const height = paneShare(ratio);
	return { height, maxHeight: height };
}

export function useComposerDragResize(
	inputRef: RefObject<HTMLElement | null>,
	enabled: boolean,
): ComposerDragResize {
	const [fillsCap, setFillsCap] = useState(false);
	const [ratio, setRatio] = useState<number | null>(null);

	useLayoutEffect(() => {
		if (!enabled) return;
		const input = inputRef.current;
		const editable = input?.querySelector<HTMLElement>(EDITABLE_SELECTOR);
		const pane = input?.closest<HTMLElement>(THREAD_ROOT_SELECTOR);
		if (!input || !editable || !pane) return;

		const measure = () => {
			const fills = fillsNaturalCap(contentHeight(input, editable), pane.clientHeight);
			setFillsCap(fills);
			if (!fills) setRatio(null);
		};
		const focusBelowText = (event: MouseEvent) => {
			if (event.target !== input || event.button !== 0) return;
			event.preventDefault();
			focusEditorEnd(editable);
		};

		measure();
		input.addEventListener("mousedown", focusBelowText);
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		observer?.observe(editable);
		observer?.observe(pane);
		return () => {
			input.removeEventListener("mousedown", focusBelowText);
			observer?.disconnect();
		};
	}, [enabled, inputRef]);

	const measureDragStart = (): ComposerDragStart | null => {
		const input = inputRef.current;
		const pane = input?.closest<HTMLElement>(THREAD_ROOT_SELECTOR);
		if (!input || !pane) return null;
		return { inputHeight: input.offsetHeight, paneHeight: pane.clientHeight };
	};

	const activeRatio = enabled ? ratio : null;
	return {
		canResize: enabled && fillsCap,
		ratio: activeRatio,
		setRatio,
		measureDragStart,
		inputStyle: inputStyleFor(enabled, activeRatio),
	};
}
