import { describe, expect, it } from "vitest";

import { EMPTY_FILTER } from "./board-insights";
import { createSwarmBoardStore } from "./swarm-board-store";

function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (index) => [...data.keys()][index] ?? null,
		removeItem: (key) => void data.delete(key),
		setItem: (key, value) => void data.set(key, value),
	};
}

describe("the Swarm Board store", () => {
	it("remembers how far each board was read across restarts, only ever forward", () => {
		const storage = memoryStorage();
		const store = createSwarmBoardStore(storage);
		store.getState().markSeen("root", 10);
		store.getState().markSeen("root", 5);
		expect(createSwarmBoardStore(storage).getState().seen).toEqual({ root: 10 });
	});

	it("survives unreadable storage", () => {
		const storage = memoryStorage();
		storage.setItem("kilo.chat/swarm-board-seen", "{not json");
		expect(createSwarmBoardStore(storage).getState().seen).toEqual({});
	});

	it("keeps each board's filter", () => {
		const store = createSwarmBoardStore(memoryStorage());
		store.getState().setFilter("root", { ...EMPTY_FILTER, query: "schema" });
		expect(store.getState().filters.root?.query).toBe("schema");
	});
});
