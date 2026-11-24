import { useRef, useSyncExternalStore } from "react";

import type { AnyExtensionPoint, Contribution } from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";

const NONE: readonly never[] = [];

const same = (
	a: readonly Contribution<AnyExtensionPoint>[],
	b: readonly Contribution<AnyExtensionPoint>[],
) =>
	a.length === b.length &&
	a.every(
		(contribution, index) =>
			contribution.key === b[index]!.key &&
			contribution.metadata === b[index]!.metadata &&
			contribution.implementation === b[index]!.implementation,
	);

/**
 * Like `useExtensions`, for a point another plugin owns that chat only
 * `requires` optionally: none while that plugin isn't installed.
 */
export function useOptionalExtensions<TPoint extends AnyExtensionPoint>(
	point: TPoint,
): readonly Contribution<TPoint>[] {
	const kernel = useKernel();
	const cache = useRef<readonly Contribution<TPoint>[]>(NONE);
	const subscribe = (onChange: () => void) =>
		kernel.extensions.subscribe((pointId) => {
			if (pointId === point.id) onChange();
		});
	const read = () => {
		if (!kernel.extensions.hasPoint(point.id)) return NONE;
		const next = kernel.extensions.list(point);
		if (!same(cache.current, next)) cache.current = next;
		return cache.current;
	};
	return useSyncExternalStore(subscribe, read);
}
