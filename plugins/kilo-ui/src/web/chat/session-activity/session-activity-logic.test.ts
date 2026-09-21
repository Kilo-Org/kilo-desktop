import { describe, expect, it } from "vitest";

import {
	KILO_DESKTOP_METADATA_KEY,
	applyHydratedSessionStatus,
	applySessionActivityEvent,
	applySessionPatch,
	buildKiloDesktopSessionMetadata,
	createEmptySessionActivity,
	deriveSessionRowState,
	directoryBasename,
	EMPTY_SESSION_ACTIVITY_STATE,
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	hasKiloDesktopSessionMetadata,
	isOrphanedWorktreeSession,
	needsAttention,
	readKiloDesktopSessionMetadata,
	readWorkspaceFoldersFromMetadata,
	readSessionInfoPatch,
	readWorkspaceIdFromMetadata,
	resolveSessionLocationLabel,
	type SessionActivity,
	type SessionActivityState,
} from "./session-activity-logic.js";

const NOW = 1_700_000_000_000;

function stateWith(
	sessions: Record<string, Partial<SessionActivity>>,
	rest?: Partial<SessionActivityState>,
): SessionActivityState {
	const full: Record<string, SessionActivity> = {};
	for (const [id, session] of Object.entries(sessions)) {
		full[id] = { ...createEmptySessionActivity(), ...session };
	}
	return { ...EMPTY_SESSION_ACTIVITY_STATE, sessions: full, ...rest };
}

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

describe("applySessionActivityEvent", () => {
	it("tracks pending permissions by id and ignores duplicates", () => {
		const asked = {
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "ses-1" },
		};
		const first = applySessionActivityEvent(EMPTY_SESSION_ACTIVITY_STATE, asked, NOW);
		expect(first?.sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-1"]);

		const duplicate = first && applySessionActivityEvent(first, asked, NOW);
		expect(duplicate).toBeNull();

		const replied =
			first &&
			applySessionActivityEvent(
				first,
				{ type: "permission.replied", properties: { sessionID: "ses-1", requestID: "perm-1" } },
				NOW,
			);
		expect(replied?.sessions["ses-1"]?.pendingPermissionIds).toEqual([]);
	});

	it("tracks v2 permission events", () => {
		const asked = applySessionActivityEvent(
			EMPTY_SESSION_ACTIVITY_STATE,
			{ type: "permission.v2.asked", properties: { id: "perm-9", sessionID: "ses-1" } },
			NOW,
		);
		expect(asked?.sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-9"]);

		const replied =
			asked &&
			applySessionActivityEvent(
				asked,
				{ type: "permission.v2.replied", properties: { sessionID: "ses-1", requestID: "perm-9" } },
				NOW,
			);
		expect(replied?.sessions["ses-1"]?.pendingPermissionIds).toEqual([]);
	});

	it("tracks questions across asked/replied/rejected", () => {
		let state = applySessionActivityEvent(
			EMPTY_SESSION_ACTIVITY_STATE,
			{ type: "question.asked", properties: { id: "q-1", sessionID: "ses-1" } },
			NOW,
		);
		state =
			state &&
			applySessionActivityEvent(
				state,
				{ type: "question.v2.asked", properties: { id: "q-2", sessionID: "ses-1" } },
				NOW,
			);
		expect(state?.sessions["ses-1"]?.pendingQuestionIds).toEqual(["q-1", "q-2"]);

		state =
			state &&
			applySessionActivityEvent(
				state,
				{ type: "question.replied", properties: { sessionID: "ses-1", requestID: "q-1" } },
				NOW,
			);
		state =
			state &&
			applySessionActivityEvent(
				state,
				{ type: "question.v2.rejected", properties: { sessionID: "ses-1", requestID: "q-2" } },
				NOW,
			);
		expect(state?.sessions["ses-1"]?.pendingQuestionIds).toEqual([]);
	});

	it("stamps workingSince on the idle-to-busy edge only", () => {
		const busy = applySessionActivityEvent(
			EMPTY_SESSION_ACTIVITY_STATE,
			{ type: "session.status", properties: { sessionID: "ses-1", status: { type: "busy" } } },
			NOW,
		);
		expect(busy?.sessions["ses-1"]).toMatchObject({ status: "busy", workingSince: NOW });

		const retry =
			busy &&
			applySessionActivityEvent(
				busy,
				{ type: "session.status", properties: { sessionID: "ses-1", status: { type: "retry" } } },
				NOW + 5000,
			);
		expect(retry?.sessions["ses-1"]).toMatchObject({ status: "retry", workingSince: NOW });
	});

	it("stamps completedAt on the busy-to-idle edge and clears workingSince", () => {
		const busy = stateWith({ "ses-1": { status: "busy", workingSince: NOW - 3000 } });
		const idle = applySessionActivityEvent(
			busy,
			{ type: "session.status", properties: { sessionID: "ses-1", status: { type: "idle" } } },
			NOW,
		);
		expect(idle?.sessions["ses-1"]).toMatchObject({
			status: "idle",
			workingSince: undefined,
			completedAt: NOW,
		});
	});

	it("treats session.idle like an idle status", () => {
		const busy = stateWith({ "ses-1": { status: "busy", workingSince: NOW - 3000 } });
		const idle = applySessionActivityEvent(
			busy,
			{ type: "session.idle", properties: { sessionID: "ses-1" } },
			NOW,
		);
		expect(idle?.sessions["ses-1"]?.completedAt).toBe(NOW);
	});

	it("ignores idle for unknown or already-idle sessions", () => {
		expect(
			applySessionActivityEvent(
				EMPTY_SESSION_ACTIVITY_STATE,
				{ type: "session.status", properties: { sessionID: "ses-1", status: { type: "idle" } } },
				NOW,
			),
		).toBeNull();

		const idle = stateWith({ "ses-1": { status: "idle" } });
		expect(
			applySessionActivityEvent(
				idle,
				{ type: "session.idle", properties: { sessionID: "ses-1" } },
				NOW,
			),
		).toBeNull();
	});

	it("marks a completion on the open session as visited", () => {
		const busy = stateWith(
			{ "ses-1": { status: "busy", workingSince: NOW - 3000 } },
			{ openSessionId: "ses-1" },
		);
		const idle = applySessionActivityEvent(
			busy,
			{ type: "session.status", properties: { sessionID: "ses-1", status: { type: "idle" } } },
			NOW,
		);
		expect(idle?.lastVisitedAtBySessionId["ses-1"]).toBe(NOW);
		expect(
			deriveSessionRowState(idle?.sessions["ses-1"], idle?.lastVisitedAtBySessionId["ses-1"]),
		).toBeNull();
	});

	it("merges session info from session.updated", () => {
		const updated = applySessionActivityEvent(
			EMPTY_SESSION_ACTIVITY_STATE,
			{
				type: "session.updated",
				properties: {
					sessionID: "ses-1",
					info: {
						id: "ses-1",
						directory: "/repo/project",
						time: { created: NOW - 100, updated: NOW },
						metadata: { [KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" } },
					},
				},
			},
			NOW,
		);
		expect(updated?.sessions["ses-1"]).toMatchObject({
			directory: "/repo/project",
			createdAt: NOW - 100,
			updatedAt: NOW,
			workspaceId: "ws-1",
		});

		const again =
			updated &&
			applySessionActivityEvent(
				updated,
				{
					type: "session.updated",
					properties: {
						sessionID: "ses-1",
						info: {
							id: "ses-1",
							directory: "/repo/project",
							time: { created: NOW - 100, updated: NOW },
							metadata: { [KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" } },
						},
					},
				},
				NOW,
			);
		expect(again).toBeNull();

		const unscoped =
			updated &&
			applySessionActivityEvent(
				updated,
				{
					type: "session.updated",
					properties: {
						sessionID: "ses-1",
						info: {
							id: "ses-1",
							directory: "/repo/project",
							time: { created: NOW - 100, updated: NOW },
							metadata: { [KILO_DESKTOP_METADATA_KEY]: {} },
						},
					},
				},
				NOW,
			);
		expect(unscoped?.sessions["ses-1"]?.workspaceId).toBeUndefined();
	});

	it("removes sessions on session.deleted", () => {
		const state = stateWith({ "ses-1": { directory: "/repo" }, "ses-2": {} });
		const next = applySessionActivityEvent(
			state,
			{ type: "session.deleted", properties: { sessionID: "ses-1", info: { id: "ses-1" } } },
			NOW,
		);
		expect(Object.keys(next?.sessions ?? {})).toEqual(["ses-2"]);
	});

	it("returns null for unrelated events", () => {
		expect(
			applySessionActivityEvent(
				EMPTY_SESSION_ACTIVITY_STATE,
				{ type: "message.part.updated", properties: { part: { sessionID: "ses-1" } } },
				NOW,
			),
		).toBeNull();
	});
});

describe("applySessionPatch / readSessionInfoPatch", () => {
	it("only applies defined fields and reports no-ops", () => {
		const session: SessionActivity = {
			...createEmptySessionActivity(),
			directory: "/old",
			createdAt: 1,
		};
		expect(applySessionPatch(session, { directory: "/new" })).toEqual({
			...session,
			directory: "/new",
		});
		expect(applySessionPatch(session, { directory: "/old" })).toBeNull();
		expect(applySessionPatch(session, {})).toBeNull();
	});

	it("builds nested kilo-desktop metadata for scoped and unscoped sessions", () => {
		expect(buildKiloDesktopSessionMetadata()).toEqual({
			metadata: { [KILO_DESKTOP_METADATA_KEY]: {} },
		});
		expect(buildKiloDesktopSessionMetadata({ workspaceId: "ws-1" })).toEqual({
			metadata: { [KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" } },
		});
		expect(
			buildKiloDesktopSessionMetadata({
				workspaceId: "ws-1",
				workspaceFolders: [
					{ path: "/workspace/main", isPrimary: true },
					{ path: "/workspace/reference", isPrimary: false },
				],
			}),
		).toEqual({
			metadata: {
				[KILO_DESKTOP_METADATA_KEY]: {
					workspaceId: "ws-1",
					workspaceFolders: [
						{ path: "/workspace/main", isPrimary: true },
						{ path: "/workspace/reference", isPrimary: false },
					],
				},
			},
		});
	});

	it("reads workspace id from nested kilo-desktop metadata", () => {
		expect(
			readWorkspaceIdFromMetadata({
				[KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" },
				other: "x",
			}),
		).toBe("ws-1");
		expect(readKiloDesktopSessionMetadata({ [KILO_DESKTOP_METADATA_KEY]: {} })).toEqual({});
		expect(readWorkspaceIdFromMetadata({ other: "x" })).toBeUndefined();
		expect(readWorkspaceIdFromMetadata(undefined)).toBeUndefined();
		expect(readWorkspaceIdFromMetadata("nope")).toBeUndefined();
		expect(
			readWorkspaceFoldersFromMetadata({
				[KILO_DESKTOP_METADATA_KEY]: {
					workspaceFolders: [
						{ path: "/workspace/main", isPrimary: true },
						{ path: "", isPrimary: false },
						{ path: "/workspace/missing-flag" },
					],
				},
			}),
		).toEqual([{ path: "/workspace/main", isPrimary: true }]);
		expect(readWorkspaceFoldersFromMetadata(undefined)).toEqual([]);
	});

	it("detects kilo-desktop-owned sessions for list filtering", () => {
		expect(hasKiloDesktopSessionMetadata({ [KILO_DESKTOP_METADATA_KEY]: {} })).toBe(true);
		expect(hasKiloDesktopSessionMetadata({ anaconda: {} })).toBe(true);
		expect(
			hasKiloDesktopSessionMetadata({ [KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" } }),
		).toBe(true);
		expect(hasKiloDesktopSessionMetadata({ "kilo-desktop.workspaceId": "ws-legacy" })).toBe(false);
		expect(hasKiloDesktopSessionMetadata({ other: "x" })).toBe(false);
		expect(hasKiloDesktopSessionMetadata(undefined)).toBe(false);
	});

	it("reads pre-rename session metadata without writing it for new sessions", () => {
		expect(readWorkspaceIdFromMetadata({ anaconda: { workspaceId: "ws-old" } })).toBe("ws-old");
		expect(buildKiloDesktopSessionMetadata({ workspaceId: "ws-new" })).toEqual({
			metadata: { "kilo-desktop": { workspaceId: "ws-new" } },
		});
	});

	it("reads session info patches from raw session objects", () => {
		expect(
			readSessionInfoPatch({
				directory: "/repo",
				time: { created: 1, updated: 2 },
				metadata: { [KILO_DESKTOP_METADATA_KEY]: { workspaceId: "ws-1" } },
			}),
		).toEqual({
			directory: "/repo",
			createdAt: 1,
			updatedAt: 2,
			workspaceId: "ws-1",
			worktreeBranch: null,
		});
		expect(
			readSessionInfoPatch({
				directory: "/repo",
				metadata: { [KILO_DESKTOP_METADATA_KEY]: {} },
			}),
		).toEqual({ directory: "/repo", workspaceId: null, worktreeBranch: null });
		expect(readSessionInfoPatch({ directory: "/repo" })).toEqual({ directory: "/repo" });
		expect(readSessionInfoPatch({ directory: "/repo", metadata: undefined })).toEqual({
			directory: "/repo",
		});
	});

	it("stamps worktree branch into nested kilo-desktop metadata", () => {
		expect(
			buildKiloDesktopSessionMetadata({
				workspaceId: "ws-1",
				worktreeBranch: "kilo/ambitious-keyboard",
			}),
		).toEqual({
			metadata: {
				[KILO_DESKTOP_METADATA_KEY]: {
					workspaceId: "ws-1",
					worktree: { branch: "kilo/ambitious-keyboard" },
				},
			},
		});
		expect(buildKiloDesktopSessionMetadata({ worktreeBranch: "kilo/x" })).toEqual({
			metadata: { [KILO_DESKTOP_METADATA_KEY]: { worktree: { branch: "kilo/x" } } },
		});
	});

	it("round-trips the worktree branch through session info patches", () => {
		expect(
			readSessionInfoPatch({
				directory: "/repo",
				metadata: { [KILO_DESKTOP_METADATA_KEY]: { worktree: { branch: "kilo/x" } } },
			}),
		).toEqual({ directory: "/repo", workspaceId: null, worktreeBranch: "kilo/x" });
		const merged = applySessionPatch(createEmptySessionActivity(), {
			worktreeBranch: "kilo/x",
		});
		expect(merged).toEqual({ ...createEmptySessionActivity(), worktreeBranch: "kilo/x" });
		expect(
			applySessionPatch(merged ?? createEmptySessionActivity(), { worktreeBranch: null }),
		).toEqual(createEmptySessionActivity());
	});

	it("clears a stamped workspace id", () => {
		const session: SessionActivity = {
			...createEmptySessionActivity(),
			directory: "/repo",
			workspaceId: "ws-1",
		};
		expect(applySessionPatch(session, { workspaceId: null })).toEqual({
			...createEmptySessionActivity(),
			directory: "/repo",
		});
		expect(applySessionPatch(session, { workspaceId: "ws-1" })).toBeNull();
	});
});

describe("applyHydratedSessionStatus", () => {
	it("stamps workingSince for a newly observed busy session", () => {
		expect(applyHydratedSessionStatus(undefined, "busy", NOW)).toEqual({
			...createEmptySessionActivity(),
			status: "busy",
			workingSince: NOW,
			completedAt: undefined,
		});
	});

	it("skips busy only when a live completion raced hydration", () => {
		const completed: SessionActivity = {
			...createEmptySessionActivity(),
			status: "idle",
			completedAt: NOW,
		};
		expect(
			applyHydratedSessionStatus(completed, "busy", NOW + 1, { skipBusyIfCompleted: true }),
		).toBeNull();
		expect(deriveSessionRowState(completed, NOW - 1)).toBe("done");
	});

	it("clears completedAt when a clean hydrate marks the session busy again", () => {
		const completed: SessionActivity = {
			...createEmptySessionActivity(),
			status: "idle",
			completedAt: NOW,
		};
		expect(applyHydratedSessionStatus(completed, "busy", NOW + 1)).toEqual({
			...completed,
			status: "busy",
			workingSince: NOW + 1,
			completedAt: undefined,
		});
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

describe("isOrphanedWorktreeSession", () => {
	const worktreeSession: Partial<SessionActivity> = {
		directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
		worktreeBranch: "kilo/aback-aardvark",
	};

	it("is true for the sole session in a worktree directory", () => {
		const state = stateWith({ "ses-1": worktreeSession });
		expect(isOrphanedWorktreeSession(state.sessions, "ses-1")).toBe(true);
	});

	it("is false when another session shares the worktree directory", () => {
		const state = stateWith({
			"ses-1": worktreeSession,
			"ses-2": { ...worktreeSession },
		});
		expect(isOrphanedWorktreeSession(state.sessions, "ses-1")).toBe(false);
	});

	it("is false without a worktree stamp", () => {
		const state = stateWith({
			"ses-1": { directory: "/repo/.kilo/worktrees/kilo-aback-aardvark" },
		});
		expect(isOrphanedWorktreeSession(state.sessions, "ses-1")).toBe(false);
	});

	it("is false for an unknown session id (not hydrated yet)", () => {
		const state = stateWith({});
		expect(isOrphanedWorktreeSession(state.sessions, "ses-unknown")).toBe(false);
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
