import { describe, expect, it, vi } from "vitest";

import {
	createLastVisitedStore,
	LAST_VISITED_STORAGE_KEY,
	lastVisitedOf,
	ORIGIN_LAST_VISITED_STORAGE_KEY,
} from "./last-visited";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	};
}

const s1 = { id: "s1", chatIds: ["ses_a", "ses_b"] };

describe("last-visited store", () => {
	it("remembers visits per session and saves them", () => {
		const storage = memoryStorage();
		const store = createLastVisitedStore(storage);
		const listener = vi.fn();
		store.subscribe(listener);

		store.mark("s1", 100);
		store.mark("s1", 50);

		expect(lastVisitedOf(store.snapshot(), s1)).toBe(100);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(lastVisitedOf(createLastVisitedStore(storage).snapshot(), s1)).toBe(100);
	});

	it("knows nothing of a session never visited", () => {
		expect(lastVisitedOf(createLastVisitedStore(memoryStorage()).snapshot(), s1)).toBeUndefined();
	});

	it("adopts origin's per-chat visits once, as the latest visit of a session's chats", () => {
		const storage = memoryStorage({
			[ORIGIN_LAST_VISITED_STORAGE_KEY]: JSON.stringify({ ses_a: 10, ses_b: 30, ses_c: "x" }),
		});
		const store = createLastVisitedStore(storage);

		expect(lastVisitedOf(store.snapshot(), s1)).toBe(30);
		store.mark("s1", 20);
		expect(lastVisitedOf(store.snapshot(), s1)).toBe(20);

		storage.values.set(ORIGIN_LAST_VISITED_STORAGE_KEY, JSON.stringify({ ses_a: 999 }));
		const reloaded = createLastVisitedStore(storage);
		expect(lastVisitedOf(reloaded.snapshot(), s1)).toBe(20);
		expect(lastVisitedOf(reloaded.snapshot(), { id: "s2", chatIds: ["ses_b"] })).toBe(30);
	});

	it("survives unreadable and unwritable storage", () => {
		const broken = {
			getItem: () => "{not json",
			setItem: () => {
				throw new Error("full");
			},
		};
		const store = createLastVisitedStore(broken);

		store.mark("s1", 5);

		expect(lastVisitedOf(store.snapshot(), s1)).toBe(5);
		expect(lastVisitedOf(createLastVisitedStore(null).snapshot(), s1)).toBeUndefined();
	});

	it("reads its own key when it is saved", () => {
		const storage = memoryStorage({
			[LAST_VISITED_STORAGE_KEY]: JSON.stringify({
				sessions: { s1: 7, bad: "x" },
				originChats: null,
			}),
		});

		expect(lastVisitedOf(createLastVisitedStore(storage).snapshot(), s1)).toBe(7);
	});
});
