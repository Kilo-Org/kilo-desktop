import {
	useCallback,
	useState,
	type ComponentProps,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

export function ResizablePanelGroup({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="resizable-panel-group"
			className={cn("flex h-full min-h-0 min-w-0", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export function ResizablePanel({
	className,
	style,
	width,
	children,
	...props
}: ComponentProps<"div"> & { width?: number }) {
	return (
		<div
			data-slot="resizable-panel"
			className={cn("min-h-0 min-w-0 overflow-hidden", className)}
			style={{ ...style, ...(width != null ? { width, flex: "none" } : { flex: 1 }) }}
			{...props}
		>
			{children}
		</div>
	);
}

export function ResizableHandle({
	onResize,
	className,
	ariaLabel = "Resize pane",
	orientation = "vertical",
	qaId = "chat-pane-resize",
}: {
	onResize?: (delta: number) => void;
	className?: string;
	ariaLabel?: string;
	orientation?: "vertical" | "horizontal";
	qaId?: string;
}) {
	const [active, setActive] = useState(false);
	const vertical = orientation === "vertical";
	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!onResize) return;
			event.preventDefault();
			const handle = event.currentTarget;
			const start = vertical ? event.clientX : event.clientY;
			handle.setPointerCapture(event.pointerId);
			setActive(true);
			const onMove = (moveEvent: PointerEvent) => {
				onResize((vertical ? moveEvent.clientX : moveEvent.clientY) - start);
			};
			const onUp = (upEvent: PointerEvent) => {
				handle.releasePointerCapture(upEvent.pointerId);
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onUp);
				setActive(false);
			};
			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onUp);
		},
		[onResize, vertical],
	);
	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!onResize) return;
			const shrink = vertical ? "ArrowLeft" : "ArrowUp";
			const grow = vertical ? "ArrowRight" : "ArrowDown";
			if (event.key !== shrink && event.key !== grow) return;
			event.preventDefault();
			const step = event.shiftKey ? 40 : 12;
			onResize(event.key === shrink ? -step : step);
		},
		[onResize, vertical],
	);

	return (
		<div
			role="separator"
			aria-label={ariaLabel}
			aria-orientation={orientation}
			tabIndex={onResize ? 0 : undefined}
			data-slot="resizable-handle"
			data-qa-id={qaId}
			data-active={active ? "true" : undefined}
			className={cn(
				"group absolute z-10 touch-none bg-transparent outline-none",
				vertical
					? "inset-y-0 -right-1.5 w-2 cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-transparent before:content-['']"
					: "inset-x-0 -bottom-1 h-2 cursor-row-resize before:absolute before:inset-x-0 before:bottom-0.5 before:h-0.5 before:bg-transparent before:content-['']",
				"hover:before:bg-primary/70 focus-visible:before:bg-primary before:transition-colors before:duration-150 motion-reduce:before:transition-none",
				active && "before:bg-primary",
				className,
			)}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
		/>
	);
}
