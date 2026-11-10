import { describe, expect, it } from "vitest";

import type { WorkSession } from "../../contracts";
import {
	EMPTY_SESSION_LIST_SELECTION,
	extendSessionListSelection,
	selectSessionListRange,
	worktreesOrphanedBy,
	type SessionListSelection,
} from "./session-list-selection";

const session = (id: string, patch: Partial<WorkSession> = {}): WorkSession => ({
	id,
	title: id,
	titleSource: "user",
	pinned: false,
	archived: false,
	archiveChangedAt: 0,
	workspaceId: null,
	branch: null,
	directory: null,
	chatIds: [],
	createdAt: 0,
	updatedAt: 0,
	...patch,
});

const order = ["a", "b", "c", "d", "e"];
const click = (
	selection: SessionListSelection,
	id: string,
	range = false,
	openId: string | null = null,
) => extendSessionListSelection(selection, { id, range, order, openId });
const ids = (selection: SessionListSelection) => [...selection.ids].sort();

describe("extendSessionListSelection", () => {
	it("starts from the open session on the first modifier click", () => {
		const selection = click(EMPTY_SESSION_LIST_SELECTION, "c", false, "a");
		expect(ids(selection)).toEqual(["a", "c"]);
		expect(selection.anchor).toBe("c");
	});

	it("ignores an open session that is not in the list", () => {
		expect(ids(click(EMPTY_SESSION_LIST_SELECTION, "c", false, "zz"))).toEqual(["c"]);
	});

	it("toggles a row off and moves the anchor to it", () => {
		const selection = click(click(EMPTY_SESSION_LIST_SELECTION, "b"), "b");
		expect(ids(selection)).toEqual([]);
		expect(selection.anchor).toBe("b");
	});

	it("adds the range between the anchor and the clicked row in either direction", () => {
		expect(ids(click(click(EMPTY_SESSION_LIST_SELECTION, "b"), "d", true))).toEqual([
			"b",
			"c",
			"d",
		]);
		expect(ids(click(click(EMPTY_SESSION_LIST_SELECTION, "d"), "b", true))).toEqual([
			"b",
			"c",
			"d",
		]);
	});

	it("ranges from the open session when nothing is selected yet", () => {
		expect(ids(click(EMPTY_SESSION_LIST_SELECTION, "c", true, "a"))).toEqual(["a", "b", "c"]);
	});

	it("keeps rows picked earlier when adding a range", () => {
		const picked = click(click(EMPTY_SESSION_LIST_SELECTION, "a"), "d");
		expect(ids(click(picked, "e", true))).toEqual(["a", "d", "e"]);
	});

	it("falls back to a toggle when the anchor has left the list", () => {
		const stale: SessionListSelection = { ids: new Set(["gone"]), anchor: "gone" };
		expect(ids(click(stale, "c", true))).toEqual(["c", "gone"]);
	});
});

describe("selectSessionListRange", () => {
	const range = (selection: SessionListSelection, from: string, to: string) =>
		selectSessionListRange(selection, { from, to, order });

	it("starts at the focused row when nothing is selected", () => {
		const selection = range(EMPTY_SESSION_LIST_SELECTION, "b", "c");
		expect(ids(selection)).toEqual(["b", "c"]);
		expect(selection.anchor).toBe("b");
	});

	it("grows and shrinks around a fixed anchor, as Shift+Arrow does in Finder", () => {
		const grown = range(range(EMPTY_SESSION_LIST_SELECTION, "b", "c"), "c", "d");
		expect(ids(grown)).toEqual(["b", "c", "d"]);
		expect(ids(range(grown, "d", "c"))).toEqual(["b", "c"]);
		expect(ids(range(range(grown, "d", "c"), "c", "a"))).toEqual(["a", "b"]);
	});
});

describe("worktreesOrphanedBy", () => {
	const sessions = [
		session("solo", { directory: "/wt/solo", branch: "kilo/solo" }),
		session("shared1", { directory: "/wt/shared", branch: "kilo/shared" }),
		session("shared2", { directory: "/wt/shared", branch: "kilo/shared" }),
		session("local", { directory: "/repo" }),
	];

	it("lists a worktree only when every session using it is deleted", () => {
		expect(worktreesOrphanedBy(sessions, new Set(["solo", "shared1", "local"]))).toEqual([
			"kilo/solo",
		]);
		expect(worktreesOrphanedBy(sessions, new Set(["shared1", "shared2"]))).toEqual(["kilo/shared"]);
	});

	it("ignores sessions without a worktree or unknown ids", () => {
		expect(worktreesOrphanedBy(sessions, new Set(["local", "unknown"]))).toEqual([]);
	});
});
