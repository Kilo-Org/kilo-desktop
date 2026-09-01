import { useCallback, useEffect, useRef, type RefObject } from "react";

type ScrollLock = {
	id: symbol;
	scrollPosition: number;
};

type ScrollContainerLockState = {
	locks: ScrollLock[];
	originalOverflowAnchor: string;
	originalScrollBehavior: string;
	originalScrollTo: HTMLElement["scrollTo"];
	resetPosition: () => void;
};

/**
 * One coordinator owns each scroll container while disclosures animate. Nested
 * activity groups can overlap, so the newest lock supplies the fixed position
 * and the container is restored only after the final lock releases.
 */
const scrollContainerLocks = new WeakMap<HTMLElement, ScrollContainerLockState>();

const acquireScrollContainerLock = (scrollContainer: HTMLElement): (() => void) => {
	const lock: ScrollLock = {
		id: Symbol("scroll-lock"),
		scrollPosition: scrollContainer.scrollTop,
	};
	let state = scrollContainerLocks.get(scrollContainer);

	if (state) {
		state.locks.push(lock);
	} else {
		const locks = [lock];
		const resetPosition = () => {
			const activeLock = locks.at(-1);
			if (activeLock && scrollContainer.scrollTop !== activeLock.scrollPosition) {
				scrollContainer.scrollTop = activeLock.scrollPosition;
			}
		};
		const blockProgrammaticScroll: HTMLElement["scrollTo"] = () => {
			resetPosition();
			// assistant-ui records bottom-scroll intent before calling scrollTo.
			// Re-signal the originating pointer interaction so that blocked intent
			// cannot unexpectedly apply to a later, unrelated content resize.
			scrollContainer.dispatchEvent(new Event("pointerdown"));
		};

		state = {
			locks,
			originalOverflowAnchor: scrollContainer.style.overflowAnchor,
			originalScrollBehavior: scrollContainer.style.scrollBehavior,
			originalScrollTo: scrollContainer.scrollTo,
			resetPosition,
		};
		scrollContainerLocks.set(scrollContainer, state);

		scrollContainer.style.overflowAnchor = "none";
		scrollContainer.style.scrollBehavior = "auto";
		scrollContainer.scrollTo = blockProgrammaticScroll;
		scrollContainer.addEventListener("scroll", resetPosition);
	}

	return () => {
		const currentState = scrollContainerLocks.get(scrollContainer);
		if (!currentState) return;

		const lockIndex = currentState.locks.findIndex(({ id }) => id === lock.id);
		if (lockIndex === -1) return;
		currentState.locks.splice(lockIndex, 1);

		if (currentState.locks.length > 0) {
			currentState.resetPosition();
			return;
		}

		scrollContainer.removeEventListener("scroll", currentState.resetPosition);
		scrollContainer.scrollTo = currentState.originalScrollTo;
		scrollContainer.style.scrollBehavior = currentState.originalScrollBehavior;
		scrollContainer.style.overflowAnchor = currentState.originalOverflowAnchor;
		scrollContainerLocks.delete(scrollContainer);
	};
};

/**
 * Locks the nearest scroll container vertically during a height animation.
 * The chat viewport already reserves symmetric scrollbar gutters, so keeping
 * the scrollbar visible avoids replacing those gutters with one-sided padding.
 */
export function useStableGutterScrollLock<T extends HTMLElement>(
	animatedElementRef: RefObject<T | null>,
	animationDuration: number,
): () => void {
	const cleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => () => cleanupRef.current?.(), []);

	return useCallback(() => {
		cleanupRef.current?.();

		let scrollContainer: HTMLElement | null = animatedElementRef.current;
		while (scrollContainer) {
			const { overflowY } = getComputedStyle(scrollContainer);
			if (overflowY === "scroll" || overflowY === "auto") break;
			scrollContainer = scrollContainer.parentElement;
		}
		if (!scrollContainer) return;

		const releaseScrollContainer = acquireScrollContainerLock(scrollContainer);
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const animationFrameId = requestAnimationFrame(() => {
			timeoutId = setTimeout(() => {
				releaseScrollContainer();
				cleanupRef.current = null;
			}, animationDuration);
		});

		cleanupRef.current = () => {
			cancelAnimationFrame(animationFrameId);
			if (timeoutId !== null) clearTimeout(timeoutId);
			releaseScrollContainer();
		};
	}, [animatedElementRef, animationDuration]);
}
