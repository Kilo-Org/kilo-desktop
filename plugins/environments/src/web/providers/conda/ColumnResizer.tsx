import { useEffect, useRef } from "react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { KEYBOARD_RESIZE_STEP } from "./column-widths.js";

/**
 * Grab handle straddling one edge of a column header.
 *
 * It only reports the width the pointer or arrow key is asking for; clamping and
 * persistence stay with the caller and `column-widths.ts`. `edge` says which
 * side of the column the handle sits on, which decides whether dragging right
 * widens or narrows: a trailing handle grows with the pointer, while a leading
 * handle (used by columns pinned to the right of a flexible one) grows against
 * it.
 */
export function ColumnResizer({
	label,
	width,
	minWidth,
	qaId,
	edge = "trailing",
	className,
	onResize,
}: {
	label: string;
	width: number;
	minWidth: number;
	qaId: string;
	edge?: "leading" | "trailing";
	/** Position override for headers that separate columns with a gap rather than a border. */
	className?: string;
	onResize: (nextWidthPx: number, options: { persist: boolean }) => void;
}) {
	const direction = edge === "trailing" ? 1 : -1;
	// Held so a drag started on this handle can be cleaned up on unmount or
	// pointercancel without leaking window-level listeners past the component's
	// lifetime.
	const teardownRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			teardownRef.current?.();
			teardownRef.current = null;
		};
	}, []);

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${label} column`}
			aria-valuenow={width}
			aria-valuemin={minWidth}
			tabIndex={0}
			data-qa-id={qaId}
			className={cn(
				"group/resizer absolute inset-y-0 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none",
				edge === "trailing" ? "-right-1.5" : "-left-1.5",
				className,
			)}
			onPointerDown={(event) => {
				// Keeps the press from selecting header text mid-drag; focus is set
				// explicitly so the same handle stays keyboard-adjustable afterwards.
				event.preventDefault();
				event.currentTarget.focus();
				// Cancel any drag that somehow survived (e.g. a fast re-press).
				teardownRef.current?.();
				const startX = event.clientX;
				const startWidth = width;
				const preview = (moveEvent: PointerEvent) => {
					onResize(startWidth + direction * (moveEvent.clientX - startX), { persist: false });
				};
				const finish = (endEvent: PointerEvent, persist: boolean) => {
					teardown();
					onResize(startWidth + direction * (endEvent.clientX - startX), { persist });
				};
				const commit = (upEvent: PointerEvent) => finish(upEvent, true);
				const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false);
				const teardown = () => {
					window.removeEventListener("pointermove", preview);
					window.removeEventListener("pointerup", commit);
					window.removeEventListener("pointercancel", cancel);
					teardownRef.current = null;
				};
				window.addEventListener("pointermove", preview);
				window.addEventListener("pointerup", commit);
				window.addEventListener("pointercancel", cancel);
				teardownRef.current = teardown;
			}}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const towards = event.key === "ArrowRight" ? 1 : -1;
				onResize(width + direction * towards * KEYBOARD_RESIZE_STEP, { persist: true });
			}}
		>
			{/*
			 * Faint at rest so the header stays quiet, clearer as soon as the pointer
			 * enters the header row, and unmistakable on the handle itself — the
			 * grab target is otherwise easy to miss entirely.
			 */}
			<span
				aria-hidden="true"
				className="bg-border group-hover/columns:bg-foreground/30 group-hover/resizer:bg-primary group-focus-visible/resizer:bg-primary h-full w-px transition-all group-hover/resizer:w-0.5 group-focus-visible/resizer:w-0.5"
			/>
		</div>
	);
}
