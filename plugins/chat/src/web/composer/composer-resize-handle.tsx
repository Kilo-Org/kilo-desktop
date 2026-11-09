import { cn } from "@kilo-desktop/ui/lib/utils";
import { type FC, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import {
	MAX_DRAG_RATIO,
	NATURAL_RATIO,
	dragRatioFromPointer,
	stepDragRatio,
} from "./composer-height/composer-height";
import type { ComposerDragStart } from "./composer-height/use-composer-drag-resize";

/** Pointer travel below this is a click (e.g. half of a double-click), not a drag. */
const DRAG_THRESHOLD = 3;

type DragState = ComposerDragStart & { pointerId: number; startY: number; moved: boolean };

/**
 * Grip on the composer's top edge, shown once the text fills the natural cap.
 * Dragging up raises the input to at most MAX_DRAG_RATIO of the pane; it never
 * goes below the natural cap. Double-click, Enter, or Home drop it back.
 */
export const ComposerResizeHandle: FC<{
	ratio: number | null;
	onResize: (ratio: number | null) => void;
	measureDragStart: () => ComposerDragStart | null;
}> = ({ ratio, onResize, measureDragStart }) => {
	const drag = useRef<DragState | null>(null);
	const [dragging, setDragging] = useState(false);
	const currentRatio = ratio ?? NATURAL_RATIO;

	const endDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		drag.current = null;
		setDragging(false);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const next =
			event.key === "ArrowUp"
				? stepDragRatio(currentRatio, 1, event.shiftKey)
				: event.key === "ArrowDown"
					? stepDragRatio(currentRatio, -1, event.shiftKey)
					: event.key === "End"
						? MAX_DRAG_RATIO
						: event.key === "Home" || event.key === "Enter"
							? null
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		onResize(next);
	};

	return (
		<div
			role="separator"
			aria-label="Resize message input"
			aria-orientation="horizontal"
			aria-valuemin={Math.round(NATURAL_RATIO * 100)}
			aria-valuemax={Math.round(MAX_DRAG_RATIO * 100)}
			aria-valuenow={Math.round(currentRatio * 100)}
			aria-valuetext={`${Math.round(currentRatio * 100)}% of the chat pane`}
			tabIndex={0}
			data-qa-id="kilo-composer-resize-handle"
			data-dragging={dragging ? "true" : undefined}
			className="group absolute inset-x-(--composer-radius) -top-1.5 z-20 flex h-3 cursor-row-resize touch-none items-center justify-center outline-none"
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				const start = measureDragStart();
				if (!start) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = {
					...start,
					pointerId: event.pointerId,
					startY: event.clientY,
					moved: false,
				};
				setDragging(true);
			}}
			onPointerMove={(event) => {
				const current = drag.current;
				if (current?.pointerId !== event.pointerId) return;
				const deltaY = event.clientY - current.startY;
				if (!current.moved && Math.abs(deltaY) < DRAG_THRESHOLD) return;
				current.moved = true;
				onResize(dragRatioFromPointer(current.inputHeight, deltaY, current.paneHeight));
			}}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onDoubleClick={() => onResize(null)}
			onKeyDown={handleKeyDown}
		>
			<span
				aria-hidden
				className={cn(
					"animate-in fade-in-0 zoom-in-50 h-1 w-8 rounded-full duration-200 ease-out motion-reduce:animate-none",
					"bg-muted-foreground/25 transition-colors motion-reduce:transition-none",
					"group-hover:bg-muted-foreground/50 group-focus-visible:bg-muted-foreground/70 group-data-[dragging=true]:bg-muted-foreground/70",
				)}
			/>
		</div>
	);
};
