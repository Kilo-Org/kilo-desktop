import { randomUUID } from "node:crypto";

import {
	KernelError,
	mainHost,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	SavedItems,
	WorkSessions,
	type AddSavedItemInput,
	type SavedItem,
} from "../../contracts/model";

export interface SavedOptions {
	readonly createId?: () => string;
	readonly now?: () => number;
}

type PersistedSaved = { items: SavedItem[]; addedTotal: number };

export const SAVED_NAMESPACE = "saved";

const sameItem = (item: SavedItem, input: AddSavedItemInput) =>
	item.source === input.source &&
	item.workSessionId === input.workSessionId &&
	item.ref.type === input.ref.type &&
	item.ref.id === input.ref.id &&
	item.anchor === input.anchor;

/**
 * Saved in main: one list of items, newest first, kept in kilo.work-sessions'
 * kv store (`saved`) as a single value so every change is one atomic write.
 * Adding an exact duplicate answers the item already saved; Undo restores a
 * removed item with its id and time, in its place by time. A deleted work
 * session's items go with it. Only the text a person chose to save is kept;
 * telemetry never sees it.
 */
export function activateSaved(sdk: PluginSdk, options: SavedOptions = {}): void {
	const createId = options.createId ?? (() => `saved_${randomUUID()}`);
	const now = options.now ?? Date.now;
	const store = mainHost(sdk).storage.kv<PersistedSaved>({
		namespace: SAVED_NAMESPACE,
		defaults: { items: [], addedTotal: 0 },
	});

	const saved: DomainObjectProvider<typeof SavedItems> = sdk.domainObjects.provide(SavedItems, {
		initialState: { items: store.get("items"), addedTotal: store.get("addedTotal") },
		methods: {
			add: (input) => {
				const existing = saved.state.items.find((item) => sameItem(item, input));
				if (existing) return existing;
				if (
					!sdk.domainObjects
						.get(WorkSessions)
						?.getState()
						.workSessions.some((workSession) => workSession.id === input.workSessionId)
				) {
					throw new KernelError("NOT_FOUND", "That session no longer exists.");
				}
				const item: SavedItem = { ...input, id: createId(), createdAt: now() };
				write([item, ...saved.state.items], saved.state.addedTotal + 1);
				saved.emit("added", { item });
				return item;
			},
			remove: ({ id }) => {
				const item = saved.state.items.find((candidate) => candidate.id === id) ?? null;
				if (!item) return { removed: null };
				write(saved.state.items.filter((candidate) => candidate.id !== id));
				saved.emit("removed", { item });
				return { removed: item };
			},
			restore: ({ item }) => {
				const existing = saved.state.items.find((candidate) => candidate.id === item.id);
				if (existing) return existing;
				const items = [...saved.state.items, item].sort((a, b) => b.createdAt - a.createdAt);
				write(items);
				saved.emit("added", { item });
				return item;
			},
		},
	});

	function write(items: SavedItem[], addedTotal = saved.state.addedTotal): void {
		store.set({ items, addedTotal });
		saved.setState({ items, addedTotal });
	}

	const stopDeleted = sdk.domainObjects.get(WorkSessions)?.on("deleted", ({ workSession }) => {
		const kept = saved.state.items.filter((item) => item.workSessionId !== workSession.id);
		if (kept.length !== saved.state.items.length) write(kept);
	});
	sdk.onDispose(() => stopDeleted?.());
}
