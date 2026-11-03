import { describe, expect, it, vi } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createMemoryStorage, createTestKernelPair } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { BOARD_DEFINITIONS, DEFAULT_BOARD } from "../contracts";
import { createBoardMainEntry } from "../main/entry";
import { createBoardStore, type BoardStore } from "./board-store";
import { formatRelativeTime } from "./relative-time";

/** kilo.workspace-board's real main entry and a window's store on it. */
async function boot(options: { withMain?: boolean } = {}) {
	const main = createBoardMainEntry();
	let store: BoardStore | undefined;
	const pair = await createTestKernelPair({
		main:
			options.withMain === false ? [] : [{ manifest, definitions: BOARD_DEFINITIONS, entry: main }],
		renderer: [
			{
				manifest,
				definitions: BOARD_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						let id = 0;
						store = createBoardStore(sdk, () => `col-${++id}`);
					},
				}),
			},
		],
		mainHostServices: () => ({ storage: createMemoryStorage("/data/kilo.workspace-board") }),
	});
	return { ...pair, store: store! };
}

const ids = (store: BoardStore, columnId: string) =>
	store.snapshot().columns.find((column) => column.id === columnId)?.sessionIds;

describe("the board store", () => {
	it("applies changes at once and keeps them until main has saved them all", async () => {
		const { store, renderer, main } = await boot();
		const seen = vi.fn();
		store.subscribe(seen);

		store.place("a", "backlog");
		store.place("b", "backlog", 0);
		expect(ids(store, "backlog")).toEqual(["b", "a"]);

		await main.flush();
		await renderer.flush();
		await vi.waitFor(() => expect(ids(store, "backlog")).toEqual(["b", "a"]));
		expect(seen).toHaveBeenCalled();

		const columnId = store.addColumn("Later");
		expect(columnId).toBe("col-1");
		store.renameColumn("col-1", " Someday ");
		store.moveColumn("col-1", 0);
		store.remove("a");
		store.remove("missing");
		await vi.waitFor(() =>
			expect(store.snapshot().columns[0]).toEqual({
				id: "col-1",
				label: "Someday",
				sessionIds: [],
			}),
		);
		store.deleteColumn("col-1");
		store.clear();
		await vi.waitFor(() => expect(store.snapshot()).toEqual(DEFAULT_BOARD));
	});

	it("falls back to the saved board when a change fails", async () => {
		const { store } = await boot();
		store.renameColumn("backlog", "x".repeat(60));
		expect(store.snapshot().columns[0]?.label).toHaveLength(60);
		await vi.waitFor(() => expect(store.snapshot()).toEqual(DEFAULT_BOARD));
	});

	it("shows the default board and changes nothing without kilo.workspace-board's main", async () => {
		const { store } = await boot({ withMain: false });
		expect(store.available()).toBe(false);
		store.place("a", "backlog");
		expect(store.addColumn("Later")).toBeNull();
		expect(store.snapshot()).toEqual(DEFAULT_BOARD);
	});
});

describe("formatRelativeTime", () => {
	it("compacts recent times and dates older ones", () => {
		const now = Date.UTC(2026, 9, 30, 12);
		expect(formatRelativeTime(now - 10_000, now)).toBe("now");
		expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
		expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d");
		expect(formatRelativeTime(now - 30 * 86_400_000, now)).toMatch(/\w+ \d+|\d+ \w+/);
	});
});
