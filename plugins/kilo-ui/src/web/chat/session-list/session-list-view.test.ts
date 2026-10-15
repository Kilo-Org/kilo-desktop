import { describe, expect, it } from "vitest";

import {
	createEmptySessionActivity,
	type SessionActivity,
} from "../session-activity/session-activity-logic.js";
import {
	DEFAULT_SESSION_LIST_VIEW,
	buildSessionListSections,
	isDefaultSessionListView,
	parseSessionListView,
	resolveSessionListGrouping,
	resolveWorkspaceFocus,
	visibleShowFields,
	writeSessionListPins,
	writeSessionListView,
	type SessionListView,
	type SessionListViewEntry,
} from "./session-list-view.js";

const workspaces = [
	{ id: "ws-1", name: "Acme App" },
	{ id: "ws-2", name: "Beta" },
];

function entry(
	id: string,
	sourceIndex: number,
	archived = false,
	title = id,
): SessionListViewEntry {
	return { id: `local-${id}`, remoteId: id, title, sourceIndex, archived };
}

function activity(patch: Partial<SessionActivity> = {}): SessionActivity {
	return { ...createEmptySessionActivity(), ...patch };
}

const defaultView: SessionListView = { ...DEFAULT_SESSION_LIST_VIEW };

describe("writeSessionListView", () => {
	it("ignores unavailable storage", () => {
		const storage = {
			setItem() {
				throw new Error("Storage unavailable");
			},
		};

		expect(() => writeSessionListView(defaultView, storage)).not.toThrow();
	});

	it("ignores inaccessible browser storage", () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("Storage inaccessible");
			},
		});

		try {
			expect(() => writeSessionListView(defaultView)).not.toThrow();
		} finally {
			if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
			else Reflect.deleteProperty(globalThis, "localStorage");
		}
	});
});

describe("writeSessionListPins", () => {
	it("ignores unavailable storage", () => {
		const storage = {
			setItem() {
				throw new Error("Storage unavailable");
			},
		};

		expect(() => writeSessionListPins(["session-1"], storage)).not.toThrow();
	});
});

describe("parseSessionListView", () => {
	it("returns defaults for invalid payloads", () => {
		expect(parseSessionListView(null)).toEqual(DEFAULT_SESSION_LIST_VIEW);
		expect(parseSessionListView({ grouping: "repo", show: ["pr"] })).toEqual(
			DEFAULT_SESSION_LIST_VIEW,
		);
		expect(parseSessionListView({ grouping: "none" }).grouping).toBe("lifecycle");
	});

	it("keeps known fields and drops unknown show values", () => {
		expect(
			parseSessionListView({
				grouping: "updated",
				ordering: "title",
				show: ["workspace", "pr", "status"],
				status: "working",
			}),
		).toEqual({
			grouping: "updated",
			ordering: "title",
			show: ["workspace", "pr"],
			status: "working",
			focus: null,
		});
	});

	it("keeps a focused workspace id", () => {
		expect(parseSessionListView({ focus: "ws-1" }).focus).toBe("ws-1");
		expect(parseSessionListView({ focus: "" }).focus).toBeNull();
		expect(parseSessionListView({ focus: 1 }).focus).toBeNull();
	});
});

describe("isDefaultSessionListView", () => {
	it("is true only for the factory default", () => {
		expect(isDefaultSessionListView(defaultView)).toBe(true);
		expect(isDefaultSessionListView({ ...defaultView, grouping: "workspace" })).toBe(false);
		expect(isDefaultSessionListView({ ...defaultView, show: ["workspace"] })).toBe(false);
		expect(isDefaultSessionListView({ ...defaultView, focus: "ws-1" })).toBe(false);
	});
});

describe("resolveSessionListGrouping", () => {
	it("keeps workspace grouping across all workspaces", () => {
		expect(resolveSessionListGrouping({ ...defaultView, grouping: "workspace" })).toBe("workspace");
	});

	it("falls back to status grouping while a workspace is focused", () => {
		expect(
			resolveSessionListGrouping({ ...defaultView, grouping: "workspace", focus: "ws-1" }),
		).toBe("lifecycle");
	});
});

describe("visibleShowFields", () => {
	it("omits workspace when already grouping by workspace", () => {
		expect(
			visibleShowFields({ ...defaultView, grouping: "workspace", show: ["workspace", "updated"] }),
		).toEqual(["updated"]);
	});

	it("omits workspace while a workspace is focused", () => {
		expect(
			visibleShowFields({ ...defaultView, focus: "ws-1", show: ["workspace", "updated", "pr"] }),
		).toEqual(["updated", "pr"]);
	});

	it("respects an unticked Updated when grouping by updated", () => {
		expect(visibleShowFields({ ...defaultView, grouping: "updated", show: ["pr"] })).toEqual([
			"pr",
		]);
	});
});

describe("buildSessionListSections", () => {
	const entries = [
		entry("ses-1", 0, false, "Fix the bug"),
		entry("ses-2", 1, false, "Add tests"),
		entry("ses-3", 0, true, "Old work"),
		entry("ses-4", 1, true, "Blocked archive"),
	];
	const activityBySessionId = {
		"ses-1": activity({ createdAt: 10, updatedAt: 10, workspaceId: "ws-1" }),
		"ses-2": activity({ createdAt: 20, updatedAt: 20, workspaceId: "ws-2" }),
		"ses-3": activity({ updatedAt: 30, workspaceId: "ws-1" }),
		"ses-4": activity({
			updatedAt: 40,
			workspaceId: "ws-2",
			pendingPermissionIds: ["perm-1"],
		}),
	};

	it("matches lifecycle partition with attention first and recency ordering", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: defaultView,
		});

		expect(sections.map((section) => section.key)).toEqual(["active", "archived"]);
		expect(sections[0]?.label).toBe("Active");
		expect(sections[0]?.rows.map((row) => row.id)).toEqual(["local-ses-2", "local-ses-1"]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-4", "local-ses-3"]);
	});

	it("sorts by title when requested", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, ordering: "title" },
		});

		expect(sections.find((section) => section.key === "active")?.rows.map((row) => row.id)).toEqual(
			["local-ses-2", "local-ses-1"],
		);
	});

	it("sorts active sessions by their latest update", () => {
		const sections = buildSessionListSections({
			entries: [entry("older-updated", 0), entry("newer-stale", 1)],
			activityBySessionId: {
				"older-updated": activity({ createdAt: 10, updatedAt: 40 }),
				"newer-stale": activity({ createdAt: 20, updatedAt: 30 }),
			},
			workspaces,
			view: defaultView,
		});

		expect(sections.find((section) => section.key === "active")?.rows.map((row) => row.id)).toEqual(
			["local-older-updated", "local-newer-stale"],
		);
	});

	it("keeps working sessions in turn-start order while their updates stream in", () => {
		const sections = buildSessionListSections({
			entries: [entry("started-first", 0), entry("started-second", 1), entry("idle", 2)],
			activityBySessionId: {
				"started-first": activity({ status: "busy", workingSince: 100, updatedAt: 500 }),
				"started-second": activity({ status: "retry", workingSince: 200, updatedAt: 400 }),
				idle: activity({ status: "idle", updatedAt: 150 }),
			},
			workspaces,
			view: defaultView,
		});

		expect(sections.find((section) => section.key === "active")?.rows.map((row) => row.id)).toEqual(
			["local-started-second", "local-idle", "local-started-first"],
		);
	});

	it("filters by status without dropping source indices", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, status: "archived" },
		});

		expect(sections).toEqual([
			{
				key: "archived",
				label: "Archived",
				tone: "archived",
				rows: [
					{ id: "local-ses-4", archived: true },
					{ id: "local-ses-3", archived: true },
				],
			},
		]);
	});

	it("groups active chats by workspace and keeps archived chats in a final shelf", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["workspace:ws-1", "Acme App"],
			["workspace:ws-2", "Beta"],
			["archived", "Archived"],
		]);
		expect(sections[0]?.rows.map((row) => row.id)).toEqual(["local-ses-1"]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-2"]);
		expect(sections[2]?.rows.map((row) => row.id)).toEqual(["local-ses-4", "local-ses-3"]);
	});

	it("does not use the unscoped session directory as a workspace group", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-unscoped", 0, false, "Unscoped greeting")],
			activityBySessionId: {
				"ses-unscoped": activity({ directory: "/chats/session-uSrBjH" }),
			},
			workspaces: [],
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["workspace:unknown", "No workspace"],
		]);
	});

	it("puts chats without a workspace in a final group after the named workspaces", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-unscoped", 0, false, "Unscoped greeting"), entry("ses-1", 1)],
			activityBySessionId: {
				"ses-unscoped": activity({ directory: "/chats/session-uSrBjH" }),
				"ses-1": activity({ workspaceId: "ws-z" }),
			},
			workspaces: [...workspaces, { id: "ws-z", name: "Zeta" }],
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => section.label)).toEqual([
			"Acme App",
			"Beta",
			"Zeta",
			"No workspace",
		]);
	});

	it("lists every workspace when grouping by workspace, even without chats", () => {
		const sections = buildSessionListSections({
			entries: [],
			activityBySessionId: {},
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections).toEqual([
			{
				key: "workspace:ws-1",
				label: "Acme App",
				tone: "workspace",
				rows: [],
				workspaceId: "ws-1",
			},
			{
				key: "workspace:ws-2",
				label: "Beta",
				tone: "workspace",
				rows: [],
				workspaceId: "ws-2",
			},
		]);
	});

	it("keeps a workspace group after its only chat is archived", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-1", 0, true, "Old work")],
			activityBySessionId: { "ses-1": activity({ workspaceId: "ws-1" }) },
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.rows.length])).toEqual([
			["workspace:ws-1", 0],
			["workspace:ws-2", 0],
			["archived", 1],
		]);
	});

	it("keeps empty workspace groups while a status filter hides their chats", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace", status: "attention" },
		});

		expect(sections.map((section) => [section.key, section.rows.map((row) => row.id)])).toEqual([
			["workspace:ws-1", []],
			["workspace:ws-2", []],
		]);
	});

	it("shows only the Archived shelf when filtering archived chats by workspace", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace", status: "archived" },
		});

		expect(sections.map((section) => [section.key, section.rows.map((row) => row.id)])).toEqual([
			["archived", ["local-ses-4", "local-ses-3"]],
		]);
	});

	it("orders sessions from deleted workspaces among the known workspaces by label", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-orphan", 0, false, "Orphan")],
			activityBySessionId: {
				"ses-orphan": activity({ workspaceId: "ws-gone", directory: "/repo/alpha" }),
			},
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["workspace:ws-1", "Acme App"],
			["workspace:ws-gone", "alpha"],
			["workspace:ws-2", "Beta"],
		]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-orphan"]);
	});

	it("omits Pinned when nothing is pinned", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: defaultView,
			pinnedIds: new Set(),
		});
		expect(sections.map((section) => section.key)).toEqual(["active", "archived"]);
	});

	it("lifts pinned sessions into Pinned and keeps attention first", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: defaultView,
			pinnedIds: new Set(["ses-1", "ses-4"]),
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["pinned", "Pinned"],
			["active", "Active"],
			["archived", "Archived"],
		]);
		expect(sections.find((section) => section.key === "pinned")?.rows.map((row) => row.id)).toEqual(
			["local-ses-1"],
		);
		expect(sections.find((section) => section.key === "active")?.rows.map((row) => row.id)).toEqual(
			["local-ses-2"],
		);
		expect(
			sections.find((section) => section.key === "archived")?.rows.map((row) => row.id),
		).toEqual(["local-ses-4", "local-ses-3"]);
	});

	it("lifts active pinned sessions above workspace groups but keeps archived chats last", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
			pinnedIds: new Set(["ses-1", "ses-3", "ses-4"]),
		});

		expect(sections.map((section) => section.key)).toEqual([
			"pinned",
			"workspace:ws-1",
			"workspace:ws-2",
			"archived",
		]);
		expect(sections.find((section) => section.key === "pinned")?.rows.map((row) => row.id)).toEqual(
			["local-ses-1"],
		);
		expect(
			sections.find((section) => section.key === "workspace:ws-1")?.rows.map((row) => row.id),
		).toEqual([]);
		expect(
			sections.find((section) => section.key === "workspace:ws-2")?.rows.map((row) => row.id),
		).toEqual(["local-ses-2"]);
		expect(
			sections.find((section) => section.key === "archived")?.rows.map((row) => row.id),
		).toEqual(["local-ses-4", "local-ses-3"]);
	});

	it("keeps archived chats in a final shelf when grouping by updated time", () => {
		const now = new Date(2026, 7, 18, 15, 0, 0).getTime();
		const sections = buildSessionListSections({
			entries: [entry("ses-active", 0), entry("ses-archived", 1, true)],
			activityBySessionId: {
				"ses-active": activity({ updatedAt: now }),
				"ses-archived": activity({ updatedAt: now }),
			},
			workspaces,
			view: { ...defaultView, grouping: "updated" },
			now,
		});

		expect(sections.map((section) => section.key)).toEqual(["updated:today", "archived"]);
		expect(sections[0]?.rows.map((row) => row.id)).toEqual(["local-ses-active"]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-archived"]);
	});

	it("groups by local calendar buckets and keeps attention in its day", () => {
		const now = new Date(2026, 7, 18, 15, 0, 0).getTime();
		const noonDaysAgo = (days: number) => {
			const day = new Date(2026, 7, 18, 12, 0, 0);
			day.setDate(day.getDate() - days);
			return day.getTime();
		};
		const sections = buildSessionListSections({
			entries: [
				entry("ses-today", 0, false, "Today chat"),
				entry("ses-attention", 1, false, "Needs a click"),
				entry("ses-yesterday", 2, false, "Yesterday chat"),
				entry("ses-week", 3, false, "Midweek chat"),
				entry("ses-month", 4, false, "Older month chat"),
				entry("ses-older", 5, false, "Ancient chat"),
			],
			activityBySessionId: {
				"ses-today": activity({ updatedAt: noonDaysAgo(0) }),
				"ses-attention": activity({
					updatedAt: noonDaysAgo(0) - 60_000,
					pendingPermissionIds: ["perm-1"],
				}),
				"ses-yesterday": activity({ updatedAt: noonDaysAgo(1) }),
				"ses-week": activity({ updatedAt: noonDaysAgo(3) }),
				"ses-month": activity({ updatedAt: noonDaysAgo(10) }),
				"ses-older": activity({ updatedAt: noonDaysAgo(40) }),
			},
			workspaces,
			view: { ...defaultView, grouping: "updated" },
			now,
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["updated:today", "Today"],
			["updated:yesterday", "Yesterday"],
			["updated:week", "Last 7 Days"],
			["updated:month", "Last 30 Days"],
			["updated:older", "Older"],
		]);
		expect(sections[0]?.rows.map((row) => row.id)).toEqual([
			"local-ses-attention",
			"local-ses-today",
		]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-yesterday"]);
		expect(sections[2]?.rows.map((row) => row.id)).toEqual(["local-ses-week"]);
		expect(sections[3]?.rows.map((row) => row.id)).toEqual(["local-ses-month"]);
		expect(sections[4]?.rows.map((row) => row.id)).toEqual(["local-ses-older"]);
	});

	it("puts sessions without an updated time in Older", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-unknown", 0, false, "No stamp")],
			activityBySessionId: { "ses-unknown": activity() },
			workspaces,
			view: { ...defaultView, grouping: "updated" },
			now: new Date(2026, 7, 18, 15, 0, 0).getTime(),
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["updated:older", "Older"],
		]);
	});

	it("keeps only sessions in the focused workspace", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, focus: "ws-1" },
		});

		expect(sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual([
			"local-ses-1",
			"local-ses-3",
		]);
	});

	it("hides unscoped sessions while a workspace is focused", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-unscoped", 0, false, "Unscoped greeting"), entry("ses-1", 1)],
			activityBySessionId: {
				"ses-unscoped": activity({ directory: "/chats/session-uSrBjH" }),
				"ses-1": activity({ workspaceId: "ws-1" }),
			},
			workspaces,
			view: { ...defaultView, focus: "ws-1" },
		});

		expect(sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual([
			"local-ses-1",
		]);
	});

	it("uses status grouping while focused even if workspace grouping is stored", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace", focus: "ws-1" },
		});

		expect(sections.map((section) => section.key)).toEqual(["active", "archived"]);
		expect(sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual([
			"local-ses-1",
			"local-ses-3",
		]);
	});
});

describe("resolveWorkspaceFocus", () => {
	const workspaces = [{ id: "w1" }, { id: "w2" }];

	it("keeps a focus on an existing workspace", () => {
		expect(resolveWorkspaceFocus("w2", workspaces)).toBe("w2");
	});

	it("drops no focus or a focus on a workspace that no longer exists", () => {
		expect(resolveWorkspaceFocus(null, workspaces)).toBeNull();
		expect(resolveWorkspaceFocus("deleted", workspaces)).toBeNull();
	});
});
