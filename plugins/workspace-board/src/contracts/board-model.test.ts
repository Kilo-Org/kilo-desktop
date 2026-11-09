import { describe, expect, it } from "vitest";

import {
	addColumn,
	clearBoard,
	DEFAULT_BOARD,
	deleteColumn,
	deletedColumnDestination,
	moveColumn,
	findSessionPlacement,
	placeSession,
	removeSession,
	renameColumn,
	renameSessions,
	type BoardState,
} from "./board-model";

const board: BoardState = {
	columns: [
		{ id: "backlog", label: "Backlog", sessionIds: ["a", "b", "c"] },
		{ id: "doing", label: "Doing", sessionIds: ["d"] },
		{ id: "done", label: "Done", sessionIds: [] },
	],
};

const ids = (state: BoardState) =>
	Object.fromEntries(state.columns.map((column) => [column.id, column.sessionIds]));

describe("workspace board model", () => {
	it("starts with Backlog, In progress, Review and Done columns and no cards", () => {
		expect(
			DEFAULT_BOARD.columns.map(({ id, label, sessionIds }) => [id, label, sessionIds]),
		).toEqual([
			["backlog", "Backlog", []],
			["in-progress", "In progress", []],
			["review", "Review", []],
			["done", "Done", []],
		]);
	});

	it("adds a session that is not on the board at the requested position", () => {
		expect(ids(placeSession(board, "new", "backlog", 1))).toEqual({
			backlog: ["a", "new", "b", "c"],
			doing: ["d"],
			done: [],
		});
	});

	it("moves a card between columns without leaving a copy behind", () => {
		expect(ids(placeSession(board, "b", "done", 0))).toEqual({
			backlog: ["a", "c"],
			doing: ["d"],
			done: ["b"],
		});
	});

	it("reorders within a column so the card ends at the requested index", () => {
		expect(ids(placeSession(board, "a", "backlog", 2)).backlog).toEqual(["b", "c", "a"]);
		expect(ids(placeSession(board, "c", "backlog", 0)).backlog).toEqual(["c", "a", "b"]);
	});

	it("clamps out-of-range positions to the start or end of the column", () => {
		expect(ids(placeSession(board, "new", "doing", 99)).doing).toEqual(["d", "new"]);
		expect(ids(placeSession(board, "new", "doing", -3)).doing).toEqual(["new", "d"]);
	});

	it("leaves the board untouched for an unknown column or an unchanged position", () => {
		expect(placeSession(board, "a", "missing", 0)).toBe(board);
		expect(placeSession(board, "b", "backlog", 1)).toBe(board);
	});

	it("removes a card, and is a no-op for sessions that are not on the board", () => {
		expect(ids(removeSession(board, "d")).doing).toEqual([]);
		expect(removeSession(board, "missing")).toBe(board);
	});

	it("reports where a session sits on the board", () => {
		expect(findSessionPlacement(board, "c")).toEqual({ columnId: "backlog", index: 2 });
		expect(findSessionPlacement(board, "missing")).toBeNull();
	});
});

describe("workspace board columns", () => {
	it("adds a column at the end of the board", () => {
		const next = addColumn(board, "blocked", "Blocked");
		expect(next.columns.map(({ id, label, sessionIds }) => [id, label, sessionIds])).toEqual([
			["backlog", "Backlog", ["a", "b", "c"]],
			["doing", "Doing", ["d"]],
			["done", "Done", []],
			["blocked", "Blocked", []],
		]);
	});

	it("ignores adding a column once the board holds the most it may", () => {
		const full: BoardState = {
			columns: Array.from({ length: 20 }, (_, index) => ({
				id: `c${index}`,
				label: `C${index}`,
				sessionIds: [],
			})),
		};
		expect(addColumn(full, "extra", "Extra")).toBe(full);
	});

	it("ignores adding a column whose id is already taken", () => {
		expect(addColumn(board, "doing", "Again")).toBe(board);
	});

	it("renames a column and keeps its cards", () => {
		expect(renameColumn(board, "doing", "In progress").columns[1]).toEqual({
			id: "doing",
			label: "In progress",
			sessionIds: ["d"],
		});
		expect(renameColumn(board, "doing", "Doing")).toBe(board);
		expect(renameColumn(board, "missing", "Nope")).toBe(board);
	});

	it("moves a deleted column's cards to the end of the next column", () => {
		expect(ids(deleteColumn(board, "backlog"))).toEqual({ doing: ["d", "a", "b", "c"], done: [] });
	});

	it("moves a deleted last column's cards to the end of the previous column", () => {
		const withDone = placeSession(board, "e", "done", 0);
		expect(ids(deleteColumn(withDone, "done"))).toEqual({
			backlog: ["a", "b", "c"],
			doing: ["d", "e"],
		});
	});

	it("never deletes the only column or an unknown one", () => {
		const single: BoardState = {
			columns: [{ id: "only", label: "Only", sessionIds: ["a"] }],
		};
		expect(deleteColumn(single, "only")).toBe(single);
		expect(deleteColumn(board, "missing")).toBe(board);
	});

	it("names the column that receives a deleted column's cards", () => {
		expect(deletedColumnDestination(board, "backlog")?.id).toBe("doing");
		expect(deletedColumnDestination(board, "done")?.id).toBe("doing");
		expect(deletedColumnDestination(board, "missing")).toBeNull();
	});
});

describe("moving workspace board columns", () => {
	const order = (state: BoardState) => state.columns.map((column) => column.id);

	it("moves a column to the requested position and keeps its cards", () => {
		expect(order(moveColumn(board, "done", 0))).toEqual(["done", "backlog", "doing"]);
		expect(order(moveColumn(board, "backlog", 2))).toEqual(["doing", "done", "backlog"]);
		expect(moveColumn(board, "backlog", 1).columns[1]?.sessionIds).toEqual(["a", "b", "c"]);
	});

	it("clamps positions to the board", () => {
		expect(order(moveColumn(board, "backlog", 99))).toEqual(["doing", "done", "backlog"]);
		expect(order(moveColumn(board, "done", -1))).toEqual(["done", "backlog", "doing"]);
	});

	it("leaves the board untouched for an unknown column or an unchanged position", () => {
		expect(moveColumn(board, "missing", 0)).toBe(board);
		expect(moveColumn(board, "doing", 1)).toBe(board);
	});
});

describe("clearing the session board", () => {
	it("takes every card off the board and keeps the columns in order", () => {
		expect(
			clearBoard(board).columns.map(({ id, label, sessionIds }) => [id, label, sessionIds]),
		).toEqual([
			["backlog", "Backlog", []],
			["doing", "Doing", []],
			["done", "Done", []],
		]);
	});

	it("leaves an already empty board untouched", () => {
		const empty = clearBoard(board);
		expect(clearBoard(empty)).toBe(empty);
	});
});

describe("renameSessions", () => {
	it("re-keys cards in place", () => {
		expect(ids(renameSessions(board, { b: "session-b", d: "session-d" }))).toEqual({
			backlog: ["a", "session-b", "c"],
			doing: ["session-d"],
			done: [],
		});
	});

	it("drops a renamed card whose new id is already on the board", () => {
		expect(ids(renameSessions(board, { b: "d" })).backlog).toEqual(["a", "c"]);
	});

	it("returns the same board when no card is renamed", () => {
		expect(renameSessions(board, { unknown: "x" })).toBe(board);
	});
});
