import { useEffect, useEffectEvent, type RefObject } from "react";

/* Embedded documents own their input events, so the canvas cannot capture their
 * clicks. The parent window blurs on entry, but not between sibling frames.
 * Observe the owning document's focused element while a canvas frame is hovered
 * or focused; never access its document or intercept its first interaction.
 * The canvas owns the timer and listeners and releases them on unmount.
 */
export function usePaneFrameFocus(
	canvasRef: RefObject<HTMLElement | null>,
	onActivate: (paneId: string) => void,
) {
	const activate = useEffectEvent(onActivate);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const document = canvas.ownerDocument;
		const hostWindow = document.defaultView;
		if (!hostWindow) return;
		let timer: number | undefined;
		let focusedFrame: Element | null = null;
		let hoveredFrame: Element | null = null;
		const cancel = () => {
			hostWindow.clearTimeout(timer);
			timer = undefined;
		};
		const checkFocus = () => {
			cancel();
			if (document.hidden) return;
			if (hoveredFrame && !canvas.contains(hoveredFrame)) hoveredFrame = null;
			const frame = document.activeElement;
			const ownsFrame = frame?.tagName === "IFRAME" && canvas.contains(frame);
			if (!ownsFrame) {
				focusedFrame = null;
			} else if (document.hasFocus() && frame !== focusedFrame) {
				focusedFrame = frame;
				const paneId = frame.closest<HTMLElement>("[data-pane-group-id]")?.dataset.paneId;
				if (paneId) activate(paneId);
			}
			if (ownsFrame || hoveredFrame) timer = hostWindow.setTimeout(checkFocus, 50);
		};
		const scheduleCheck = () => {
			cancel();
			timer = hostWindow.setTimeout(checkFocus, 0);
		};
		const onPointerOver = (event: PointerEvent) => {
			if (!(event.target instanceof Element) || event.target.tagName !== "IFRAME") return;
			hoveredFrame = event.target;
			scheduleCheck();
		};
		const onPointerOut = (event: PointerEvent) => {
			if (event.target !== hoveredFrame) return;
			hoveredFrame = null;
			scheduleCheck();
		};
		canvas.addEventListener("pointerover", onPointerOver, true);
		canvas.addEventListener("pointerout", onPointerOut, true);
		hostWindow.addEventListener("blur", scheduleCheck);
		hostWindow.addEventListener("focus", scheduleCheck);
		document.addEventListener("visibilitychange", scheduleCheck);
		scheduleCheck();
		return () => {
			cancel();
			canvas.removeEventListener("pointerover", onPointerOver, true);
			canvas.removeEventListener("pointerout", onPointerOut, true);
			hostWindow.removeEventListener("blur", scheduleCheck);
			hostWindow.removeEventListener("focus", scheduleCheck);
			document.removeEventListener("visibilitychange", scheduleCheck);
		};
	}, [canvasRef]);
}
