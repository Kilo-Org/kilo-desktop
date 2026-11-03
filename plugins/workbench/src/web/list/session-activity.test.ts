import { describe, expect, it } from "vitest";

import {
	activityOfSession,
	createEmptySessionActivity,
	deriveSessionRowState,
	directoryBasename,
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	needsAttention,
	resolveSessionLocationLabel,
	sessionRowCapabilities,
	type SessionActivity,
} from "./session-activity";

const NOW = 1_700_000_000_000;

describe("deriveSessionRowState", () => {
	it("prioritizes approval over input, working, and done", () => {
		const activity: SessionActivity = {
			pendingPermissionIds: ["perm-1"],
			pendingQuestionIds: ["q-1"],
			status: "busy",
			workingSince: NOW - 1000,
			completedAt: NOW,
		};
		expect(deriveSessionRowState(activity, 0)).toBe("approval");
	});

	it("prioritizes input over working and done", () => {
		const activity: SessionActivity = {
			pendingPermissionIds: [],
			pendingQuestionIds: ["q-1"],
			status: "busy",
			workingSince: NOW - 1000,
			completedAt: NOW,
		};
		expect(deriveSessionRowState(activity, 0)).toBe("input");
	});

	it("reports working for busy and retry", () => {
		const base = { pendingPermissionIds: [], pendingQuestionIds: [] };
		expect(deriveSessionRowState({ ...base, status: "busy" }, undefined)).toBe("working");
		expect(deriveSessionRowState({ ...base, status: "retry" }, undefined)).toBe("working");
	});

	it("reports done only when completed after the last visit", () => {
		const activity: SessionActivity = {
			pendingPermissionIds: [],
			pendingQuestionIds: [],
			status: "idle",
			completedAt: NOW,
		};
		expect(deriveSessionRowState(activity, NOW - 1)).toBe("done");
		expect(deriveSessionRowState(activity, NOW)).toBeNull();
		expect(deriveSessionRowState(activity, NOW + 1)).toBeNull();
	});

	it("treats never-visited sessions as read", () => {
		const activity: SessionActivity = {
			pendingPermissionIds: [],
			pendingQuestionIds: [],
			status: "idle",
			completedAt: NOW,
		};
		expect(deriveSessionRowState(activity, undefined)).toBeNull();
	});

	it("returns null without activity", () => {
		expect(deriveSessionRowState(undefined, NOW)).toBeNull();
	});
});

describe("needsAttention", () => {
	it("requires a pending permission or question", () => {
		expect(needsAttention(undefined)).toBe(false);
		expect(needsAttention(createEmptySessionActivity())).toBe(false);
		expect(needsAttention({ ...createEmptySessionActivity(), pendingPermissionIds: ["p"] })).toBe(
			true,
		);
		expect(needsAttention({ ...createEmptySessionActivity(), pendingQuestionIds: ["q"] })).toBe(
			true,
		);
	});
});

describe("formatWorkingDurationLabel", () => {
	it("formats seconds, minutes, and hours as compact labels", () => {
		expect(formatWorkingDurationLabel(0)).toBe("0s");
		expect(formatWorkingDurationLabel(45_000)).toBe("45s");
		expect(formatWorkingDurationLabel(59_999)).toBe("59s");
		expect(formatWorkingDurationLabel(60_000)).toBe("1m");
		expect(formatWorkingDurationLabel(3 * 60_000)).toBe("3m");
		expect(formatWorkingDurationLabel(80 * 60_000)).toBe("1h 20m");
		expect(formatWorkingDurationLabel(-5000)).toBe("0s");
		expect(formatWorkingDurationLabel(Number.NaN)).toBe("0s");
	});
});

describe("formatRelativeTimeLabel", () => {
	it("formats compact relative labels", () => {
		expect(formatRelativeTimeLabel(NOW, NOW)).toBe("now");
		expect(formatRelativeTimeLabel(NOW - 5 * 60_000, NOW)).toBe("5m");
		expect(formatRelativeTimeLabel(NOW - 3 * 3_600_000, NOW)).toBe("3h");
		expect(formatRelativeTimeLabel(NOW - 2 * 86_400_000, NOW)).toBe("2d");
		const dated = formatRelativeTimeLabel(NOW - 30 * 86_400_000, NOW);
		expect(dated).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
	});
});

describe("directoryBasename", () => {
	it("handles posix and windows paths", () => {
		expect(directoryBasename("/repo/project")).toBe("project");
		expect(directoryBasename("C:\\repo\\project")).toBe("project");
		expect(directoryBasename("/repo/project/")).toBe("project");
		expect(directoryBasename("project")).toBe("project");
	});
});

describe("resolveSessionLocationLabel", () => {
	const workspaces = [
		{ id: "ws-1", name: "Acme App" },
		{ id: "ws-2", name: "Other" },
	];

	it("prefers the workspace name by stamped id", () => {
		const activity: SessionActivity = {
			...createEmptySessionActivity(),
			workspaceId: "ws-1",
			directory: "/repo/renamed-folder",
		};
		expect(resolveSessionLocationLabel(activity, workspaces)).toBe("Acme App");
	});

	it("falls back to the directory basename when the workspace is gone", () => {
		const activity: SessionActivity = {
			...createEmptySessionActivity(),
			workspaceId: "ws-deleted",
			directory: "/repo/project",
		};
		expect(resolveSessionLocationLabel(activity, workspaces)).toBe("project");
	});

	it("has no location without a stamped workspace", () => {
		const activity: SessionActivity = {
			...createEmptySessionActivity(),
			directory: "/chats/session-uSrBjH",
		};
		expect(resolveSessionLocationLabel(activity, workspaces)).toBeNull();
	});

	it("has no location without any location data", () => {
		expect(resolveSessionLocationLabel(undefined, workspaces)).toBeNull();
	});
});

describe("sessionRowCapabilities", () => {
	it("lets idle and finished chats be archived and pinned", () => {
		expect(sessionRowCapabilities(false, null)).toEqual({
			isArchived: false,
			canArchive: true,
			canPin: true,
		});
		expect(sessionRowCapabilities(false, "done").canArchive).toBe(true);
	});

	it("keeps working chats and chats waiting on the user from being archived", () => {
		for (const rowState of ["working", "approval", "input"] as const) {
			expect(sessionRowCapabilities(false, rowState).canArchive).toBe(false);
		}
	});

	it("treats an archived chat that is waiting on the user as live", () => {
		expect(sessionRowCapabilities(true, "approval")).toEqual({
			isArchived: false,
			canArchive: false,
			canPin: true,
		});
		expect(sessionRowCapabilities(true, null)).toEqual({
			isArchived: true,
			canArchive: false,
			canPin: false,
		});
	});
});

describe("activityOfSession", () => {
	it("carries the session's place and times, with nothing pending", () => {
		const activity = activityOfSession({
			id: "wses_1",
			title: "Fix login",
			titleSource: "user",
			pinned: false,
			archived: false,
			archiveChangedAt: 0,
			workspaceId: "w1",
			worktreeBranch: "kilo/fix",
			directory: "/projects/app/.kilo/worktrees/fix",
			chatIds: [],
			createdAt: 1,
			updatedAt: 2,
		});

		expect(activity).toEqual({
			directory: "/projects/app/.kilo/worktrees/fix",
			workspaceId: "w1",
			worktreeBranch: "kilo/fix",
			createdAt: 1,
			updatedAt: 2,
			pendingPermissionIds: [],
			pendingQuestionIds: [],
		});
		expect(needsAttention(activity)).toBe(false);
	});
});
