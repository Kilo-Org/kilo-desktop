import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A stable ref holding the latest committed `value`, for callbacks that run
 * outside render (async work, external objects, event handlers) and must see
 * current props without being recreated.
 *
 * It is written in a layout effect, not during render, so React Compiler can
 * still compile the caller; read `.current` only outside render.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
	const ref = useRef(value);
	useLayoutEffect(() => {
		ref.current = value;
	});
	return ref;
}
