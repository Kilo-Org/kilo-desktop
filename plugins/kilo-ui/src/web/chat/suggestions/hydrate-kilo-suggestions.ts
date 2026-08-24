import type { KiloSuggestionRequest } from "./kilo-suggestion-logic.js";
import { parseSuggestionRequest } from "./kilo-suggestion-logic.js";
import type { KiloSuggestionStore } from "./kilo-suggestion-store.js";

type ListResponse<T> = { data?: T | undefined };

/** Structural subset of the Kilo client used to recover pending suggestions. */
export type KiloSuggestionHydrationClient = {
	suggestion?: {
		list(): Promise<ListResponse<unknown[]>>;
	};
};

const parseListed = (items: readonly unknown[] | undefined): KiloSuggestionRequest[] => {
	if (!items) return [];
	return items.flatMap((item) => {
		const parsed = parseSuggestionRequest(item);
		return parsed ? [parsed] : [];
	});
};

/**
 * Seeds the suggestion store from the server. Event streaming only reports
 * changes, so this runs at startup and after every stream reconnect.
 */
export async function hydrateKiloSuggestions(
	client: KiloSuggestionHydrationClient,
	store: KiloSuggestionStore,
): Promise<void> {
	const generation = store.getState().beginHydrate();
	const sinceEpoch = store.getState().activityEpoch;
	const listed = await client.suggestion?.list().catch(() => undefined);
	if (!listed) return;
	store.getState().hydrate(parseListed(listed.data), sinceEpoch, generation);
}
