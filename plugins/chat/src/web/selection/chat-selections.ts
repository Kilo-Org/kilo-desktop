import { useSyncExternalStore } from "react";

import type { ModelSelectorEffortOption } from "./model-selector";
import type { KiloModelRef } from "./model-catalog";

export type AgentSelectionState = {
	agent: string;
	dirty: boolean;
};

export type ModelSelectionState = {
	modelOverride: KiloModelRef | undefined;
	/** Last known display name for optimistic first paint. */
	name: string | undefined;
	effort: string | undefined;
	efforts: readonly ModelSelectorEffortOption[] | undefined;
	effortByModel: Readonly<Record<string, string>>;
	dirty: boolean;
};

type Records<T> = Readonly<Record<string, T>>;

/** Selections keyed by scope, readable from React with `useSelectionRecords`. */
export class SelectionRecords<T> {
	#records: Records<T> = {};
	readonly #listeners = new Set<() => void>();

	readonly subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	readonly getSnapshot = (): Records<T> => this.#records;

	update(next: (current: Records<T>) => Records<T>): void {
		const records = next(this.#records);
		if (records === this.#records) return;
		this.#records = records;
		for (const listener of this.#listeners) listener();
	}
}

export function useSelectionRecords<T>(records: SelectionRecords<T>): Records<T> {
	return useSyncExternalStore(records.subscribe, records.getSnapshot, records.getSnapshot);
}

/**
 * The window's per-chat agent and model selections.
 *
 * A pane is unmounted whenever the person switches session, so selections
 * kept in a pane's own state were lost on every switch; the chat then showed
 * (and sent with) the global "remembered for new chats" choice, which a draft
 * in another session may just have changed. Kept here, beside the window's
 * other chat services, a chat's selection (including per-model effort and
 * unsent changes) survives its pane.
 *
 * Only chats live here. A draft's selection stays in its pane: two drafts
 * (an agent pane and the New Session page) must not share one, and a draft's
 * choice reaches the chat its first send creates by promotion.
 *
 * `loaded` lists chats whose Kilo session has been read, so their recorded
 * model is known (or known to be absent). Until then a chat has no
 * selection of its own and must not borrow the global default.
 */
export class ChatSelections {
	readonly agents = new SelectionRecords<AgentSelectionState>();
	readonly models = new SelectionRecords<ModelSelectionState>();
	readonly loaded = new SelectionRecords<true>();
}
