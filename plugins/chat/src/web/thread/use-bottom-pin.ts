import { useEffect, type RefObject } from "react";

/**
 * Keeps a scroll container pinned to the bottom while `active` and new content
 * arrives. A deliberate upward scroll (at unchanged scroll height) unpins until
 * the reader scrolls back to the bottom; a pin's own scroll event can arrive
 * after new content grew the scroll height and read as "not at bottom", so only
 * an upward move at unchanged scroll height counts as user intent.
 */
export const useBottomPin = (
	scrollRef: RefObject<HTMLElement | null>,
	contentRef: RefObject<HTMLElement | null>,
	active: boolean,
): void => {
	useEffect(() => {
		if (!active) return;
		const scrollEl = scrollRef.current;
		const contentEl = contentRef.current;
		if (!scrollEl || !contentEl) return;

		let pinned = true;
		let lastScrollTop = scrollEl.scrollTop;
		let lastScrollHeight = scrollEl.scrollHeight;
		const isAtBottom = () =>
			Math.abs(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) <= 1 ||
			scrollEl.scrollHeight <= scrollEl.clientHeight;

		const pin = () => {
			if (!pinned) return;
			scrollEl.scrollTop = scrollEl.scrollHeight;
		};
		const onScroll = () => {
			if (isAtBottom()) {
				pinned = true;
			} else if (scrollEl.scrollTop < lastScrollTop && scrollEl.scrollHeight === lastScrollHeight) {
				pinned = false;
			}
			lastScrollTop = scrollEl.scrollTop;
			lastScrollHeight = scrollEl.scrollHeight;
		};

		pin();
		scrollEl.addEventListener("scroll", onScroll);
		const observer = new ResizeObserver(pin);
		observer.observe(contentEl);
		return () => {
			scrollEl.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [active, scrollRef, contentRef]);
};
