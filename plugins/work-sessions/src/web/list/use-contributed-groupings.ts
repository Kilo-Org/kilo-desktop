import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";

import { WorkSessionGrouping, type WorkSessionGroup } from "../../contracts";
import type { SessionListContributedGrouping } from "./session-list-view";

/** Plugins' session list groupings (`work-session-grouping`) with their current categories. */
export function useContributedGroupings(): readonly SessionListContributedGrouping[] {
	const contributions = useExtensions(WorkSessionGrouping);
	const sources = useMemo(
		() =>
			contributions.flatMap((contribution) =>
				contribution.implementation
					? [
							{
								id: contribution.key,
								title: contribution.metadata.title,
								source: contribution.implementation,
							},
						]
					: [],
			),
		[contributions],
	);
	const subscribe = useCallback(
		(listener: () => void) => {
			const unsubscribes = sources.map(({ source }) => source.subscribe(listener));
			return () => {
				for (const unsubscribe of unsubscribes) unsubscribe();
			};
		},
		[sources],
	);
	// useSyncExternalStore needs the same snapshot until a source's categories change.
	const getSnapshot = useMemo(() => {
		let lastGroups: readonly (readonly WorkSessionGroup[])[] = [];
		let snapshot: readonly SessionListContributedGrouping[] = [];
		return () => {
			const groups = sources.map(({ source }) => source.get());
			const unchanged =
				groups.length === lastGroups.length &&
				groups.every((entry, index) => entry === lastGroups[index]);
			if (unchanged) return snapshot;
			lastGroups = groups;
			snapshot = sources.map(({ id, title }, index) => ({
				id,
				title,
				groups: groups[index] ?? [],
			}));
			return snapshot;
		};
	}, [sources]);
	return useSyncExternalStore(subscribe, getSnapshot);
}
