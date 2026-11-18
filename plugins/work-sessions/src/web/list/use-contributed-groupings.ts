import { useRef, useSyncExternalStore } from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";

import { WorkSessionGrouping, type WorkSessionGroup } from "../../contracts";
import type { SessionListContributedGrouping } from "./session-list-view";

interface GroupingsSnapshot {
	readonly groups: readonly (readonly WorkSessionGroup[])[];
	readonly groupings: readonly SessionListContributedGrouping[];
}

const EMPTY_SNAPSHOT: GroupingsSnapshot = { groups: [], groupings: [] };

/** Plugins' session list groupings (`work-session-grouping`) with their current categories. */
export function useContributedGroupings(): readonly SessionListContributedGrouping[] {
	const contributions = useExtensions(WorkSessionGrouping);
	const sources = contributions.flatMap((contribution) =>
		contribution.implementation
			? [
					{
						id: contribution.key,
						title: contribution.metadata.title,
						source: contribution.implementation,
					},
				]
			: [],
	);
	// useSyncExternalStore needs the same snapshot until a source's categories change.
	const cache = useRef(EMPTY_SNAPSHOT);
	const subscribe = (listener: () => void) => {
		const unsubscribes = sources.map(({ source }) => source.subscribe(listener));
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	};
	const getSnapshot = () => {
		const groups = sources.map(({ source }) => source.get());
		const previous = cache.current;
		const unchanged =
			groups.length === previous.groups.length &&
			groups.every((entry, index) => entry === previous.groups[index]) &&
			sources.every(
				({ id, title }, index) =>
					previous.groupings[index]?.id === id && previous.groupings[index]?.title === title,
			);
		if (unchanged) return previous.groupings;
		cache.current = {
			groups,
			groupings: sources.map(({ id, title }, index) => ({
				id,
				title,
				groups: groups[index] ?? [],
			})),
		};
		return cache.current.groupings;
	};
	return useSyncExternalStore(subscribe, getSnapshot);
}
