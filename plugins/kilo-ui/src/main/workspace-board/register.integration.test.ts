import { afterEach, describe, expect, it, vi } from "vitest";

import type { KvStoreFactory } from "@kilo-desktop/feature-sdk";
import { createFakeMainSdk, type FakeMainSdk } from "@kilo-desktop/testing";

import {
	DEFAULT_WORKSPACE_BOARD,
	type WorkspaceBoardState,
} from "../../contracts/workspace-board/board-model.js";
import { registerWorkspaceBoard } from "./register.js";

function persistentStorage(seed?: Record<string, unknown>): KvStoreFactory {
	const stores = new Map<string, Record<string, unknown>>();
	if (seed) stores.set("workspace-board", seed);
	return (options) => {
		const namespace = options.namespace ?? "default";
		if (!stores.has(namespace)) stores.set(namespace, structuredClone(options.defaults));
		return {
			snapshot: () => structuredClone(stores.get(namespace)) as typeof options.defaults,
			get: (key) =>
				structuredClone(
					stores.get(namespace)?.[String(key)],
				) as (typeof options.defaults)[typeof key],
			set: (patch) => {
				const next = { ...stores.get(namespace), ...structuredClone(patch) };
				stores.set(namespace, next);
				return structuredClone(next) as typeof options.defaults;
			},
			clear: () => {
				stores.set(namespace, structuredClone(options.defaults));
			},
		};
	};
}

const cardsByColumn = (state: WorkspaceBoardState) =>
	Object.fromEntries(state.columns.map((column) => [column.id, column.sessionIds]));

describe("workspace board persistence", () => {
	const sdks: FakeMainSdk[] = [];
	afterEach(() => {
		for (const sdk of sdks.splice(0)) sdk.dispose();
	});

	function boot(createKvStore = persistentStorage()) {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui", createKvStore });
		registerWorkspaceBoard(sdk);
		sdks.push(sdk);
		return sdk;
	}

	it("starts with the default empty columns", async () => {
		await expect(boot().invoke("workspaceBoard.get")).resolves.toEqual(DEFAULT_WORKSPACE_BOARD);
	});

	it("places and moves cards, broadcasts each change, and reloads them after a restart", async () => {
		const storage = persistentStorage();
		const sdk = boot(storage);
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);

		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "backlog", index: 0 });
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_2", columnId: "backlog", index: 0 });
		const moved = (await sdk.invoke("workspaceBoard.place", {
			sessionId: "ses_1",
			columnId: "review",
			index: 5,
		})) as WorkspaceBoardState;

		expect(cardsByColumn(moved)).toEqual({
			backlog: ["ses_2"],
			"in-progress": [],
			review: ["ses_1"],
			done: [],
		});
		expect(changed).toHaveBeenCalledTimes(3);
		sdk.dispose();
		await expect(boot(storage).invoke("workspaceBoard.get")).resolves.toEqual(moved);
	});

	it("removes cards from the board", async () => {
		const sdk = boot();
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "done", index: 0 });
		const removed = (await sdk.invoke("workspaceBoard.remove", {
			sessionId: "ses_1",
		})) as WorkspaceBoardState;
		expect(removed).toEqual(DEFAULT_WORKSPACE_BOARD);
	});

	it("clears every card, keeps the columns, and persists the empty board", async () => {
		const storage = persistentStorage();
		const sdk = boot(storage);
		await sdk.invoke("workspaceBoard.addColumn", { columnId: "blocked", label: "Blocked" });
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "review", index: 0 });
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_2", columnId: "blocked", index: 0 });
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);

		const cleared = (await sdk.invoke("workspaceBoard.clear", undefined)) as WorkspaceBoardState;

		expect(cleared.columns.map((column) => [column.id, column.sessionIds])).toEqual([
			["backlog", []],
			["in-progress", []],
			["review", []],
			["done", []],
			["blocked", []],
		]);
		expect(changed).toHaveBeenCalledOnce();
		sdk.dispose();
		await expect(boot(storage).invoke("workspaceBoard.get")).resolves.toEqual(cleared);
	});

	it("does not write or broadcast when clearing an empty board", async () => {
		const sdk = boot();
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);
		await expect(sdk.invoke("workspaceBoard.clear", undefined)).resolves.toEqual(
			DEFAULT_WORKSPACE_BOARD,
		);
		expect(changed).not.toHaveBeenCalled();
	});

	it("does not write or broadcast when nothing changes", async () => {
		const sdk = boot();
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "done", index: 0 });
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);
		await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "done", index: 0 });
		await sdk.invoke("workspaceBoard.remove", { sessionId: "not-on-board" });
		expect(changed).not.toHaveBeenCalled();
	});

	it("rejects unknown columns without changing the board", async () => {
		const sdk = boot();
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);
		await expect(
			sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "missing", index: 0 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("workspaceBoard.get")).resolves.toEqual(DEFAULT_WORKSPACE_BOARD);
	});

	it("rejects malformed input at the handler boundary", async () => {
		const sdk = boot();
		for (const input of [
			{ sessionId: " ", columnId: "backlog", index: 0 },
			{ sessionId: "ses_1", columnId: "backlog", index: -1 },
			{ sessionId: "ses_1", columnId: "backlog", index: 1.5 },
		]) {
			await expect(sdk.invoke("workspaceBoard.place", input)).rejects.toMatchObject({
				code: "VALIDATION",
			});
		}
	});

	it("treats corrupt or unsupported stored data as the default board and recovers on the next change", async () => {
		for (const seed of [
			{ version: 2, state: DEFAULT_WORKSPACE_BOARD },
			{ version: 1, state: null },
			{ version: 1, state: { columns: [] } },
			{
				version: 1,
				state: {
					columns: [
						{ id: "a", label: "A", sessionIds: ["dup"] },
						{ id: "b", label: "B", sessionIds: ["dup"] },
					],
				},
			},
		]) {
			const storage = persistentStorage(seed);
			const sdk = boot(storage);
			await expect(sdk.invoke("workspaceBoard.get")).resolves.toEqual(DEFAULT_WORKSPACE_BOARD);
			const saved = await sdk.invoke("workspaceBoard.place", {
				sessionId: "ses_1",
				columnId: "backlog",
				index: 0,
			});
			sdk.dispose();
			await expect(boot(storage).invoke("workspaceBoard.get")).resolves.toEqual(saved);
		}
	});

	it("reports failed writes without broadcasting or changing the board", async () => {
		const storage = persistentStorage();
		let failWrites = false;
		const sdk = boot((options) => {
			const store = storage(options);
			return {
				...store,
				set: (patch) => {
					if (failWrites) throw new Error("Disk unavailable");
					return store.set(patch);
				},
			};
		});
		const saved = await sdk.invoke("workspaceBoard.place", {
			sessionId: "ses_1",
			columnId: "backlog",
			index: 0,
		});
		const changed = vi.fn();
		sdk.events.on("kilo-ui.workspace-board-changed", changed);
		failWrites = true;
		await expect(
			sdk.invoke("workspaceBoard.place", { sessionId: "ses_2", columnId: "backlog", index: 0 }),
		).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Could not save the board. Please try again.",
		});
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("workspaceBoard.get")).resolves.toEqual(saved);
	});

	describe("columns", () => {
		it("adds, renames and deletes columns, broadcasting and persisting each change", async () => {
			const storage = persistentStorage();
			const sdk = boot(storage);
			const changed = vi.fn();
			sdk.events.on("kilo-ui.workspace-board-changed", changed);
			await sdk.invoke("workspaceBoard.place", {
				sessionId: "ses_1",
				columnId: "review",
				index: 0,
			});

			await sdk.invoke("workspaceBoard.addColumn", { columnId: "blocked", label: "  Blocked " });
			await sdk.invoke("workspaceBoard.renameColumn", { columnId: "backlog", label: "Ideas" });
			const saved = (await sdk.invoke("workspaceBoard.deleteColumn", {
				columnId: "review",
			})) as WorkspaceBoardState;

			expect(saved.columns.map(({ id, label, sessionIds }) => [id, label, sessionIds])).toEqual([
				["backlog", "Ideas", []],
				["in-progress", "In progress", []],
				["done", "Done", ["ses_1"]],
				["blocked", "Blocked", []],
			]);
			expect(changed).toHaveBeenCalledTimes(4);
			sdk.dispose();
			await expect(boot(storage).invoke("workspaceBoard.get")).resolves.toEqual(saved);
		});

		it("reorders columns with their cards and persists the order", async () => {
			const storage = persistentStorage();
			const sdk = boot(storage);
			await sdk.invoke("workspaceBoard.place", { sessionId: "ses_1", columnId: "done", index: 0 });
			const saved = (await sdk.invoke("workspaceBoard.moveColumn", {
				columnId: "done",
				index: 0,
			})) as WorkspaceBoardState;

			expect(saved.columns.map((column) => [column.id, column.sessionIds])).toEqual([
				["done", ["ses_1"]],
				["backlog", []],
				["in-progress", []],
				["review", []],
			]);
			sdk.dispose();
			await expect(boot(storage).invoke("workspaceBoard.get")).resolves.toEqual(saved);
		});

		it("rejects moving a column that does not exist", async () => {
			await expect(
				boot().invoke("workspaceBoard.moveColumn", { columnId: "missing", index: 0 }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("rejects blank or overlong column names", async () => {
			const sdk = boot();
			for (const label of ["   ", "x".repeat(41)]) {
				await expect(
					sdk.invoke("workspaceBoard.renameColumn", { columnId: "backlog", label }),
				).rejects.toMatchObject({ code: "VALIDATION" });
			}
		});

		it("rejects changes to columns that do not exist", async () => {
			const sdk = boot();
			await expect(
				sdk.invoke("workspaceBoard.renameColumn", { columnId: "missing", label: "Nope" }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(
				sdk.invoke("workspaceBoard.deleteColumn", { columnId: "missing" }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("rejects a column id that is already used", async () => {
			const sdk = boot();
			await expect(
				sdk.invoke("workspaceBoard.addColumn", { columnId: "done", label: "Done again" }),
			).rejects.toMatchObject({ code: "VALIDATION", message: "That column already exists." });
		});

		it("keeps at least one column", async () => {
			const sdk = boot();
			for (const columnId of ["backlog", "in-progress", "review"]) {
				await sdk.invoke("workspaceBoard.deleteColumn", { columnId });
			}
			await expect(
				sdk.invoke("workspaceBoard.deleteColumn", { columnId: "done" }),
			).rejects.toMatchObject({
				code: "BUSINESS",
				message: "A board needs at least one column.",
			});
		});

		it("limits the board to 1,000 chats", async () => {
			const full = {
				version: 1,
				state: {
					columns: [
						{
							id: "backlog",
							label: "Backlog",
							sessionIds: Array.from({ length: 1_000 }, (_, index) => `ses_${index}`),
						},
						{ id: "done", label: "Done", sessionIds: [] },
					],
				},
			};
			const sdk = boot(persistentStorage(full));
			await expect(
				sdk.invoke("workspaceBoard.place", { sessionId: "ses_extra", columnId: "done", index: 0 }),
			).rejects.toMatchObject({ code: "VALIDATION", message: "The board is full." });
			await expect(
				sdk.invoke("workspaceBoard.place", { sessionId: "ses_0", columnId: "done", index: 0 }),
			).resolves.toBeDefined();
		});

		it("limits the board to 20 columns", async () => {
			const sdk = boot();
			for (let index = 0; index < 16; index += 1) {
				await sdk.invoke("workspaceBoard.addColumn", { columnId: `c${index}`, label: `C${index}` });
			}
			await expect(
				sdk.invoke("workspaceBoard.addColumn", { columnId: "extra", label: "Extra" }),
			).rejects.toMatchObject({
				code: "BUSINESS",
				message: "A board can have at most 20 columns.",
			});
		});
	});
});
