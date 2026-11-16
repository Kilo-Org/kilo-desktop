import { describe, expect, it } from "vitest";

import {
	defaultWorkSessionTitle,
	EMPTY_WORK_SESSION_PANES,
	isOrphanedCopySession,
	objectRefSchema,
	paneKey,
	Panes,
	WorkSessions,
	Workspaces,
	type Pane,
	type WorkSession,
} from "./index";

const workSession = (id: string, fields: Partial<WorkSession> = {}): WorkSession => ({
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
	...fields,
});

const pane = (id: string): Pane => ({
	id,
	kind: "kilo.terminal/terminal",
	title: id,
	metadata: {},
	ordinal: 1,
});

describe("work sessions", () => {
	it("are titled like a new Kilo chat until something names them", () => {
		expect(defaultWorkSessionTitle(Date.UTC(2026, 10, 10, 7, 30))).toBe(
			"New session - 2026-11-10T07:30:00.000Z",
		);
	});

	it("offer to remove a copy only when no other work session shares it", () => {
		const copy = { branch: "kilo/one", directory: "/repo/.kilo/worktrees/one" };
		const alone = [workSession("a", copy), workSession("b", { directory: "/repo" })];
		const shared = [workSession("a", copy), workSession("b", copy)];

		expect(isOrphanedCopySession(alone, "a")).toBe(true);
		expect(isOrphanedCopySession(shared, "a")).toBe(false);
		expect(isOrphanedCopySession(alone, "b")).toBe(false);
		expect(isOrphanedCopySession(alone, "missing")).toBe(false);
	});

	it("are looked up by id", () => {
		const state = { workSessions: [workSession("a"), workSession("b")] };
		expect(WorkSessions.lookup?.(state, "b")).toMatchObject({ id: "b" });
		expect(WorkSessions.lookup?.(state, "c")).toBeUndefined();
	});
});

describe("workspaces", () => {
	it("are looked up by id", () => {
		const workspace = { id: "w", name: "W", folders: [], createdAt: 0, updatedAt: 0 };
		const state = { workspaces: [workspace], activeId: null, unavailableFolderIds: [] };
		expect(Workspaces.lookup?.(state, "w")).toBe(workspace);
		expect(Workspaces.lookup?.(state, "x")).toBeUndefined();
	});
});

describe("panes", () => {
	const state = {
		byWorkSession: {
			wses_1: { ...EMPTY_WORK_SESSION_PANES, panes: [pane("p1"), pane("p2")] },
		},
	};

	it("are looked up by <workSessionId>/<paneId>", () => {
		expect(Panes.lookup?.(state, paneKey("wses_1", "p2"))).toMatchObject({ id: "p2" });
		expect(Panes.lookup?.(state, paneKey("wses_2", "p1"))).toBeUndefined();
		expect(Panes.lookup?.(state, "wses_1")).toBeUndefined();
		expect(Panes.lookup?.(state, "/p1")).toBeUndefined();
	});

	it("show objects referred to by a qualified type", () => {
		expect(
			objectRefSchema.safeParse({ type: "kilo.work-sessions/file", id: "/a.ts" }).success,
		).toBe(true);
		expect(objectRefSchema.safeParse({ type: "file", id: "/a.ts" }).success).toBe(false);
		expect(objectRefSchema.safeParse({ type: "kilo.work-sessions/file", id: "" }).success).toBe(
			false,
		);
	});
});
