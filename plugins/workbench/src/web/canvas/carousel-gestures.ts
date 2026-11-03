const CAROUSEL_PAN_BLOCKER_SELECTOR = [
	"a",
	"button",
	"input",
	"textarea",
	"select",
	"summary",
	"option",
	"[contenteditable='true']",
	"[role='button']",
	"[role='treeitem']",
	"[role='option']",
	"[role='menuitem']",
	"[role='separator']",
	"[role='textbox']",
	"[role='slider']",
	"[data-type='item']",
].join(", ");

type CarouselPointerEvent = {
	button: number;
	nativeEvent: { composedPath: () => EventTarget[] };
};

export function shouldStartCarouselPan(event: CarouselPointerEvent): boolean {
	if (event.button === 1) return true;
	if (event.button !== 0) return false;
	// Retargeted events hide shadow-DOM buttons; composedPath still sees file-tree items.
	for (const node of event.nativeEvent.composedPath()) {
		if (!(node instanceof Element)) continue;
		if (node.matches(CAROUSEL_PAN_BLOCKER_SELECTOR)) return false;
		if (node.getAttribute("data-pan-surface") === "true") return true;
	}
	return false;
}

type CarouselWheelEvent = {
	deltaX: number;
	deltaY: number;
	shiftKey: boolean;
};

type CarouselTrack = {
	scrollWidth: number;
	clientWidth: number;
};

export function shouldRedirectCarouselWheel(
	event: CarouselWheelEvent,
	track: CarouselTrack,
): boolean {
	if (track.scrollWidth <= track.clientWidth) return false;
	// Native horizontal scrolling must keep control. Programmatic scrollLeft
	// fights a focused pane and snaps the carousel back to it.
	if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false;
	return Boolean(event.shiftKey && event.deltaY);
}

function setNestedPointerEvents(viewport: HTMLElement, enabled: boolean) {
	if (enabled) viewport.dataset.carouselCapture = "true";
	else delete viewport.dataset.carouselCapture;
	for (const node of viewport.querySelectorAll<HTMLElement>("[data-pan-surface], iframe")) {
		node.style.pointerEvents = enabled ? "none" : "";
	}
}

export function bindCarouselWheel(
	viewport: HTMLElement,
	track: HTMLElement,
	onUserScroll: () => void,
) {
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Shift") return;
		setNestedPointerEvents(viewport, true);
	};
	const onKeyUp = (event: KeyboardEvent) => {
		if (event.key !== "Shift") return;
		setNestedPointerEvents(viewport, false);
	};
	const onBlur = () => setNestedPointerEvents(viewport, false);
	const onWheel = (event: WheelEvent) => {
		onUserScroll();
		if (!shouldRedirectCarouselWheel(event, track)) return;
		event.preventDefault();
		applyCarouselScroll(track, track.scrollLeft + event.deltaY);
	};

	viewport.addEventListener("wheel", onWheel, { capture: true, passive: false });
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", onBlur);
	return () => {
		viewport.removeEventListener("wheel", onWheel, { capture: true });
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("keyup", onKeyUp);
		window.removeEventListener("blur", onBlur);
		setNestedPointerEvents(viewport, false);
	};
}

export function applyCarouselScroll(track: HTMLElement, left: number) {
	const max = Math.max(0, track.scrollWidth - track.clientWidth);
	const next = Math.max(0, Math.min(max, left));
	const focused = document.activeElement;
	if (focused instanceof HTMLElement && focused !== track && track.contains(focused)) {
		focused.focus({ preventScroll: true });
		track.scrollLeft = next;
		focused.focus({ preventScroll: true });
	}
	track.scrollLeft = next;
}
