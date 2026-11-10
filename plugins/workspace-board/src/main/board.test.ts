import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { BOARD_PLUGIN_ID, DEFAULT_BOARD, type BoardState } from "../contracts";
import { bootBoardMain as boot, recordingLogger, stopBoardMains, workSession } from "./test-boot";

afterEach(stopBoardMains);

describe("the board in main", () => {
	it("starts with the default columns and places, moves and removes cards, bumping the revision", async () => {
		const { board, cards } = await boot();
		expect(board.getState()).toEqual({ board: DEFAULT_BOARD, revision: 0 });

		await board.methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		await board.methods.place({ sessionId: "b", columnId: "backlog", index: 0 });
		const revision = await board.methods.place({
			sessionId: "a",
			columnId: "review",
			index: Number.MAX_SAFE_INTEGER,
		});

		expect(revision).toBe(3);
		expect(board.getState().revision).toBe(3);
		expect(cards()).toMatchObject({ backlog: ["b"], review: ["a"] });
		await expect(
			board.methods.place({ sessionId: "a", columnId: "review", index: 0 }),
		).resolves.toBe(3);

		await board.methods.remove({ sessionId: "b" });
		await board.methods.clear(undefined);
		expect(cards()).toMatchObject({ backlog: [], review: [] });
	});

	it("adds, renames, moves and deletes columns, moving a deleted column's cards to its neighbour", async () => {
		const { board, columns, cards } = await boot();
		await board.methods.place({ sessionId: "a", columnId: "done", index: 0 });

		await board.methods.addColumn({ columnId: "later", label: "Later" });
		await board.methods.renameColumn({ columnId: "later", label: "Someday" });
		await board.methods.moveColumn({ columnId: "later", index: 0 });
		await board.methods.deleteColumn({ columnId: "done" });

		expect(columns().map((column) => column.label)).toEqual([
			"Someday",
			"Backlog",
			"In progress",
			"Review",
		]);
		expect(cards().review).toEqual(["a"]);
	});

	it("refuses unknown columns, duplicate ids, a 21st column and deleting the last column", async () => {
		const { board } = await boot();
		await expect(
			board.methods.place({ sessionId: "a", columnId: "nope", index: 0 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			board.methods.addColumn({ columnId: "backlog", label: "Again" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		for (let index = 0; index < 16; index++) {
			await board.methods.addColumn({ columnId: `c${index}`, label: `C${index}` });
		}
		await expect(
			board.methods.addColumn({ columnId: "c99", label: "Too many" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
		for (const columnId of [
			"backlog",
			"in-progress",
			"review",
			...Array.from({ length: 16 }, (_, i) => `c${i}`),
		]) {
			await board.methods.deleteColumn({ columnId });
		}
		await expect(board.methods.deleteColumn({ columnId: "done" })).rejects.toMatchObject({
			code: "BUSINESS",
		});
	});

	it("keeps the board across restarts and reads an invalid stored board as the default", async () => {
		const storage = createMemoryStorage("/data/kilo.workspace-board");
		const first = await boot({ storage });
		await first.board.methods.place({ sessionId: "a", columnId: "review", index: 0 });

		const second = await boot({ storage });
		expect(second.cards().review).toEqual(["a"]);

		storage.saved.set("board", { version: 7, state: { columns: [] }, importedFromOrigin: true });
		const third = await boot({ storage });
		expect(third.board.getState().board).toEqual(DEFAULT_BOARD);
	});

	it("adopts origin's board once, without overwriting a board already kept", async () => {
		const origin: BoardState = {
			columns: [
				{ id: "todo", label: "To do", sessionIds: ["wses_1"] },
				{ id: "doing", label: "Doing", sessionIds: [] },
			],
		};
		const storage = createMemoryStorage("/data/kilo.workspace-board");
		const first = await boot({ origin, storage });
		expect(first.board.getState().board).toEqual(origin);
		await first.board.methods.renameColumn({ columnId: "todo", label: "Next" });

		const second = await boot({ origin, storage });
		expect(second.columns()[0]?.label).toBe("Next");
	});

	it("starts empty when origin had no board or an unreadable one, and retries one it could not read", async () => {
		expect((await boot()).board.getState().board).toEqual(DEFAULT_BOARD);
		expect((await boot({ origin: "{not json" })).board.getState().board).toEqual(DEFAULT_BOARD);

		const storage = createMemoryStorage("/data/kilo.workspace-board");
		await boot({ origin: "directory", storage });
		expect(storage.saved.get("board")?.importedFromOrigin).not.toBe(true);
	});

	it("keeps a board changed here when origin's or the previous id's board is read a launch later", async () => {
		const storage = createMemoryStorage("/data/kilo.workspace-board");
		await (
			await boot({ origin: "directory", previous: "directory", storage })
		).board.methods.place({ sessionId: "mine", columnId: "review", index: 0 });
		const theirs: BoardState = { columns: [{ id: "old", label: "Old", sessionIds: [] }] };

		const second = await boot({
			origin: theirs,
			previous: { version: 1, state: theirs, importedFromOrigin: true },
			storage,
		});

		expect(second.cards().review).toEqual(["mine"]);
	});

	it("adopts the board kept under its previous id once, without importing origin over it", async () => {
		const kept: BoardState = {
			columns: [{ id: "next", label: "Next", sessionIds: ["wses_1"] }],
		};
		const origin: BoardState = { columns: [{ id: "old", label: "Old", sessionIds: [] }] };
		const previous = { version: 1, state: kept, importedFromOrigin: true };
		const storage = createMemoryStorage("/data/kilo.workspace-board");

		const first = await boot({ previous, origin, storage });
		expect(first.board.getState().board).toEqual(kept);
		await first.board.methods.renameColumn({ columnId: "next", label: "Soon" });

		const second = await boot({ previous, origin, storage });
		expect(second.columns()[0]?.label).toBe("Soon");
	});

	it("tries the previous id's board again when it can't be read, and skips one that's invalid", async () => {
		const storage = createMemoryStorage("/data/kilo.workspace-board");
		await boot({ previous: "directory", storage });
		const kept: BoardState = { columns: [{ id: "next", label: "Next", sessionIds: [] }] };

		const retried = await boot({ previous: { version: 1, state: kept }, storage });
		expect(retried.board.getState().board).toEqual(kept);

		const invalid = await boot({ previous: { version: 9 } });
		expect(invalid.board.getState().board).toEqual(DEFAULT_BOARD);
	});

	it("moves cards origin saved under a chat id to the work session holding the chat", async () => {
		const origin: BoardState = {
			columns: [{ id: "todo", label: "To do", sessionIds: ["ses_chat", "wses_2"] }],
		};
		const { cards, workSessions } = await boot({ origin, workSessions: [workSession("wses_2")] });
		expect(cards().todo).toEqual(["ses_chat", "wses_2"]);

		workSessions.set([workSession("wses_1", ["ses_chat"]), workSession("wses_2")]);

		expect(cards().todo).toEqual(["wses_1", "wses_2"]);
	});

	it("drops a deleted work session's card", async () => {
		const { board, cards, workSessions } = await boot({
			workSessions: [workSession("a"), workSession("b")],
		});
		await board.methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		await board.methods.place({ sessionId: "b", columnId: "backlog", index: 1 });

		workSessions.delete("a");

		expect(cards().backlog).toEqual(["b"]);
	});

	it("works without kilo.work-sessions, saying nothing at activation", async () => {
		const { logger, warnings, errors } = recordingLogger();
		const { board, cards } = await boot({ withoutWorkSessions: true, logger });

		await board.methods.place({ sessionId: "a", columnId: "backlog", index: 0 });

		expect(cards().backlog).toEqual(["a"]);
		// The kernel reports the manifest's contributions to absent plugins; the entry says nothing.
		const own = warnings.filter(
			([message]) => !String(message).startsWith(`[${BOARD_PLUGIN_ID}] Contribution`),
		);
		expect(own).toEqual([]);
		expect(errors).toEqual([]);
	});
});
