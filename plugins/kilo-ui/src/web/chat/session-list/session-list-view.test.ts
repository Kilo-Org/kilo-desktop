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

const defaultView: SessionListView = { ...DEFAULT_SESSION_LIST_VIEW, show: [] };

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
			show: ["workspace"],
			status: "working",
		});
	});
});

describe("isDefaultSessionListView", () => {
	it("is true only for the factory default", () => {
		expect(isDefaultSessionListView(defaultView)).toBe(true);
		expect(isDefaultSessionListView({ ...defaultView, grouping: "workspace" })).toBe(false);
		expect(isDefaultSessionListView({ ...defaultView, show: ["workspace"] })).toBe(false);
	});
});

describe("visibleShowFields", () => {
	it("omits workspace when already grouping by workspace", () => {
		expect(
			visibleShowFields({ ...defaultView, grouping: "workspace", show: ["workspace", "updated"] }),
		).toEqual(["updated"]);
	});

	it("always shows updated time when grouping by updated", () => {
		expect(visibleShowFields({ ...defaultView, grouping: "updated", show: [] })).toEqual([
			"updated",
		]);
		expect(visibleShowFields({ ...defaultView, grouping: "updated", show: ["workspace"] })).toEqual(
			["workspace", "updated"],
		);
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

		expect(sections.map((section) => section.key)).toEqual(["attention", "active", "settled"]);
		expect(sections[0]?.label).toBe("Needs Attention");
		expect(sections[0]?.rows).toEqual([{ id: "local-ses-4", archived: true, sourceIndex: 1 }]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-2", "local-ses-1"]);
		expect(sections[2]?.rows.map((row) => row.id)).toEqual(["local-ses-3"]);
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

	it("filters by status without dropping source indices", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, status: "settled" },
		});

		expect(sections).toEqual([
			{
				key: "settled",
				label: "Settled",
				tone: "settled",
				rows: [{ id: "local-ses-3", archived: true, sourceIndex: 0 }],
			},
		]);
	});

	it("groups by workspace with attention sessions at the top of their workspace", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["workspace:ws-1", "Acme App"],
			["workspace:ws-2", "Beta"],
		]);
		expect(sections[0]?.rows.map((row) => row.id)).toEqual(["local-ses-3", "local-ses-1"]);
		expect(sections[1]?.rows.map((row) => row.id)).toEqual(["local-ses-4", "local-ses-2"]);
	});

	it("does not use the unscoped session directory as a workspace group", () => {
		const sections = buildSessionListSections({
			entries: [entry("ses-unscoped", 0, false, "Unscoped greeting")],
			activityBySessionId: {
				"ses-unscoped": activity({ directory: "/chats/session-uSrBjH" }),
			},
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
		});

		expect(sections.map((section) => [section.key, section.label])).toEqual([
			["workspace:unknown", "No workspace"],
		]);
	});

	it("omits Pinned when nothing is pinned", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: defaultView,
			pinnedIds: new Set(),
		});
		expect(sections.map((section) => section.key)).toEqual(["attention", "active", "settled"]);
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
			["attention", "Needs Attention"],
			["pinned", "Pinned"],
			["active", "Active"],
			["settled", "Settled"],
		]);
		expect(sections.find((section) => section.key === "pinned")?.rows.map((row) => row.id)).toEqual(
			["local-ses-1"],
		);
		expect(sections.find((section) => section.key === "active")?.rows.map((row) => row.id)).toEqual(
			["local-ses-2"],
		);
		expect(
			sections.find((section) => section.key === "attention")?.rows.map((row) => row.id),
		).toEqual(["local-ses-4"]);
	});

	it("lifts pinned sessions above workspace groups", () => {
		const sections = buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: { ...defaultView, grouping: "workspace" },
			pinnedIds: new Set(["ses-1", "ses-4"]),
		});

		expect(sections.map((section) => section.key)).toEqual([
			"pinned",
			"workspace:ws-1",
			"workspace:ws-2",
		]);
		expect(sections.find((section) => section.key === "pinned")?.rows.map((row) => row.id)).toEqual(
			["local-ses-4", "local-ses-1"],
		);
		expect(
			sections.find((section) => section.key === "workspace:ws-1")?.rows.map((row) => row.id),
		).toEqual(["local-ses-3"]);
		expect(
			sections.find((section) => section.key === "workspace:ws-2")?.rows.map((row) => row.id),
		).toEqual(["local-ses-2"]);
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
});
