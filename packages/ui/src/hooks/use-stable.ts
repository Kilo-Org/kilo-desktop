import { useLayoutEffect, useRef, useState } from "react";

/**
 * One function for the component's lifetime that always calls the latest
 * committed `fn`. For handlers that must keep their identity (subscriptions,
 * external registries); React Compiler memoizes everything else.
 */
export function useStableCallback<Args extends readonly unknown[], Result>(
	fn: (...args: Args) => Result,
): (...args: Args) => Result {
	const latest = useRef(fn);
	useLayoutEffect(() => {
		latest.current = fn;
	});
	const [stable] = useState(
		() =>
			(...args: Args) =>
				latest.current(...args),
	);
	return stable;
}

/**
 * `value`, or the previous value while `isEqual` says they match: a reference
 * that changes only when the content does, for values rebuilt on every render
 * (parsed arrays, objects from props) that feed effects or memoized children.
 */
export function useStableValue<T>(value: T, isEqual: (previous: T, next: T) => boolean): T {
	const [stable, setStable] = useState(value);
	if (stable !== value && !isEqual(stable, value)) {
		setStable(value);
		return value;
	}
	return stable;
}
