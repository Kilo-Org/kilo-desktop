import { createStore } from "zustand/vanilla";

import {
	applySuggestionEvent,
	type KiloSuggestionEvent,
	type KiloSuggestionRequest,
} from "./kilo-suggestion-logic.js";

export type KiloSuggestionStoreState = {
	pending: readonly KiloSuggestionRequest[];
	/** Bumps when a live SSE event mutates pending; used to detect hydrate races. */
	activityEpoch: number;
	applyEvent: (event: KiloSuggestionEvent) => void;
	/** Marks a hydrate fetch as the latest; older overlapping fetches are ignored. */
	beginHydrate: () => number;
	hydrate: (
		snapshot: readonly KiloSuggestionRequest[],
		sinceEpoch?: number,
		generation?: number,
	) => void;
};

export type KiloSuggestionStore = ReturnType<typeof createKiloSuggestionStore>;

const sameIds = (
	a: readonly KiloSuggestionRequest[],
	b: readonly KiloSuggestionRequest[],
): boolean => a.length === b.length && a.every((request, index) => request.id === b[index]?.id);

/**
 * Pending `suggest` tool requests. The tool waits until accept/dismiss (or a
 * follow-up message, which auto-dismisses it) but does not block the prompt;
 * this store is the UI's view of that wait so a reconnect can recover the bar.
 *
 * Live SSE events bump `activityEpoch` so an in-flight hydrate merges instead
 * of clobbering. Overlapping hydrates (startup + reconnect) take a generation
 * so an older list() cannot resurrect suggestions a newer fetch already dropped.
 */
export function createKiloSuggestionStore() {
	const clearedIds = new Set<string>();
	let hydrateGeneration = 0;

	return createStore<KiloSuggestionStoreState>((set, get) => ({
		pending: [],
		activityEpoch: 0,
		beginHydrate: () => {
			hydrateGeneration += 1;
			return hydrateGeneration;
		},
		applyEvent: (event) => {
			const next = applySuggestionEvent(get().pending, event);
			if (!next) return;
			const previous = get().pending;
			for (const request of previous) {
				if (!next.some((item) => item.id === request.id)) clearedIds.add(request.id);
			}
			for (const request of next) clearedIds.delete(request.id);
			set((state) => ({ pending: next, activityEpoch: state.activityEpoch + 1 }));
		},
		hydrate: (snapshot, sinceEpoch, generation) => {
			if (generation !== undefined && generation !== hydrateGeneration) return;
			const liveEventsDuringFetch = sinceEpoch !== undefined && get().activityEpoch !== sinceEpoch;
			if (!liveEventsDuringFetch) clearedIds.clear();

			let next: KiloSuggestionRequest[];
			if (!liveEventsDuringFetch) {
				next = [...snapshot];
			} else {
				const merged = new Map<string, KiloSuggestionRequest>();
				for (const request of get().pending) merged.set(request.id, request);
				for (const request of snapshot) {
					if (!clearedIds.has(request.id)) merged.set(request.id, request);
				}
				for (const id of clearedIds) merged.delete(id);
				next = [...merged.values()];
			}

			if (sameIds(get().pending, next)) return;
			set({ pending: next });
		},
	}));
}
