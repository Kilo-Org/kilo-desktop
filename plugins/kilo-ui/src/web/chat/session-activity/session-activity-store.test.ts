import { describe, expect, it } from "vitest";

import { deriveSessionRowState } from "./session-activity-logic.js";
import {
	createSessionActivityStore,
	LAST_VISITED_STORAGE_KEY,
	whenSessionsRefreshed,
} from "./session-activity-store.js";

const NOW = 1_700_000_000_000;

function createMemoryStorage(initial?: Record<string, string>) {
	const data = new Map(Object.entries(initial ?? {}));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
		data,
	};
}

describe("createSessionActivityStore", () => {
	it("applies events and tracks pending attention", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "ses-1" },
		});
		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-1"]);
	});

	it("persists visits and reloads them in a new store", () => {
		const storage = createMemoryStorage();
		const store = createSessionActivityStore({ storage, now: () => NOW });
		store.getState().markVisited("ses-1");

		expect(JSON.parse(storage.data.get(LAST_VISITED_STORAGE_KEY) ?? "{}")).toEqual({
			"ses-1": NOW,
		});

		const reloaded = createSessionActivityStore({ storage, now: () => NOW });
		expect(reloaded.getState().lastVisitedAtBySessionId["ses-1"]).toBe(NOW);
	});

	it("auto-marks the open session visited when its completion arrives", () => {
		const storage = createMemoryStorage();
		const store = createSessionActivityStore({ storage, now: () => NOW });
		store.getState().setOpenSession("ses-1");
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "idle" } },
		});

		expect(store.getState().sessions["ses-1"]?.completedAt).toBe(NOW);
		expect(store.getState().lastVisitedAtBySessionId["ses-1"]).toBe(NOW);
		expect(JSON.parse(storage.data.get(LAST_VISITED_STORAGE_KEY) ?? "{}")).toEqual({
			"ses-1": NOW,
		});
	});

	it("hydrates sessions without clobbering live activity", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "question.asked",
			properties: { id: "q-1", sessionID: "ses-1" },
		});
		store
			.getState()
			.hydrateSessions([{ id: "ses-1", directory: "/repo/project", createdAt: 1, updatedAt: 2 }]);

		expect(store.getState().sessions["ses-1"]).toMatchObject({
			directory: "/repo/project",
			createdAt: 1,
			updatedAt: 2,
			pendingQuestionIds: ["q-1"],
		});
	});

	it("replaces pending requests on hydration, clearing stale entries", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-stale", sessionID: "ses-1" },
		});

		store.getState().hydratePendingRequests({
			permissions: [{ id: "perm-2", sessionID: "ses-2" }],
			questions: [{ id: "q-1", sessionID: "ses-1" }],
			sinceEpoch: store.getState().activityEpoch,
		});

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual([]);
		expect(store.getState().sessions["ses-1"]?.pendingQuestionIds).toEqual(["q-1"]);
		expect(store.getState().sessions["ses-2"]?.pendingPermissionIds).toEqual(["perm-2"]);
	});

	it("unions pending ids when live events race a stale hydration snapshot", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		const sinceEpoch = store.getState().activityEpoch;
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-live", sessionID: "ses-1" },
		});

		store.getState().hydratePendingRequests({
			permissions: [{ id: "perm-snapshot", sessionID: "ses-2" }],
			questions: [],
			sinceEpoch,
		});

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-live"]);
		expect(store.getState().sessions["ses-2"]?.pendingPermissionIds).toEqual(["perm-snapshot"]);
	});

	it("does not resurrect a permission a live reply cleared during hydration", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "ses-1" },
		});
		const sinceEpoch = store.getState().activityEpoch;
		store.getState().applyEvent({
			type: "permission.replied",
			properties: { requestID: "perm-1", sessionID: "ses-1" },
		});

		store.getState().hydratePendingRequests({
			permissions: [{ id: "perm-1", sessionID: "ses-1" }],
			questions: [],
			sinceEpoch,
		});

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual([]);
	});

	it("hydrates statuses, stamping workingSince for busy sessions", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().hydrateStatuses({
			"ses-1": { type: "busy" },
			"ses-2": { type: "idle" },
		});

		expect(store.getState().sessions["ses-1"]).toMatchObject({
			status: "busy",
			workingSince: NOW,
		});
		// Idle is the default; unknown idle sessions are not tracked.
		expect(store.getState().sessions["ses-2"]).toBeUndefined();
	});

	it("keeps the original workingSince when hydration repeats while busy", () => {
		let current = NOW;
		const store = createSessionActivityStore({ storage: null, now: () => current });
		store.getState().hydrateStatuses({ "ses-1": { type: "busy" } });

		current = NOW + 60_000;
		store.getState().hydrateStatuses({ "ses-1": { type: "busy" } });
		expect(store.getState().sessions["ses-1"]?.workingSince).toBe(NOW);
	});

	it("reconciles live working state on hydration", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});

		store.getState().hydrateStatuses({ "ses-1": { type: "idle" } });
		expect(store.getState().sessions["ses-1"]).toMatchObject({
			status: "idle",
			workingSince: undefined,
		});
		// No completion is stamped: the finish time was not observed.
		expect(store.getState().sessions["ses-1"]?.completedAt).toBeUndefined();
	});

	it("does not resurrect busy from a stale hydration after a live completion", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		const sinceEpoch = store.getState().activityEpoch;
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "idle" } },
		});

		store.getState().hydrateStatuses({ "ses-1": { type: "busy" } }, sinceEpoch);

		expect(store.getState().sessions["ses-1"]).toMatchObject({
			status: "idle",
			completedAt: NOW,
			workingSince: undefined,
		});
		expect(deriveSessionRowState(store.getState().sessions["ses-1"], NOW - 1)).toBe("done");
	});

	it("allows a clean reconnect to hydrate busy after a prior completion", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "idle" } },
		});

		store.getState().hydrateStatuses({ "ses-1": { type: "busy" } });

		expect(store.getState().sessions["ses-1"]).toMatchObject({
			status: "busy",
			workingSince: NOW,
			completedAt: undefined,
		});
	});

	it("clears completedAt when a live busy event starts a new turn", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "idle" } },
		});
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "ses-1", status: { type: "busy" } },
		});

		expect(store.getState().sessions["ses-1"]).toMatchObject({
			status: "busy",
			completedAt: undefined,
		});
	});

	it("tolerates broken storage", () => {
		const throwing = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
			removeItem: () => {},
		};
		const store = createSessionActivityStore({ storage: throwing, now: () => NOW });
		expect(() => store.getState().markVisited("ses-1")).not.toThrow();
		expect(store.getState().lastVisitedAtBySessionId["ses-1"]).toBe(NOW);
	});

	it("ignores malformed persisted visits", () => {
		const storage = createMemoryStorage({ [LAST_VISITED_STORAGE_KEY]: "{not json" });
		const store = createSessionActivityStore({ storage, now: () => NOW });
		expect(store.getState().lastVisitedAtBySessionId).toEqual({});
	});

	it("starts unsettled and flips sessionsRefreshed once a refresh settles", () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		expect(store.getState().sessionsRefreshed).toBe(false);

		store.getState().markSessionsRefreshed();

		expect(store.getState().sessionsRefreshed).toBe(true);
		// Idempotent: repeated refreshes keep the settled flag.
		store.getState().markSessionsRefreshed();
		expect(store.getState().sessionsRefreshed).toBe(true);
	});

	it("whenSessionsRefreshed resolves immediately once the flag is settled", async () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		store.getState().markSessionsRefreshed();

		await expect(whenSessionsRefreshed(store)).resolves.toBeUndefined();
	});

	it("whenSessionsRefreshed resolves when the flag flips mid-wait", async () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });
		const settled = whenSessionsRefreshed(store, 1_000);

		store.getState().markSessionsRefreshed();

		await expect(settled).resolves.toBeUndefined();
	});

	it("whenSessionsRefreshed resolves via the timeout cap when the store never settles", async () => {
		const store = createSessionActivityStore({ storage: null, now: () => NOW });

		await expect(whenSessionsRefreshed(store, 10)).resolves.toBeUndefined();
		// The capped wait must not leave a subscription behind.
		store.getState().markSessionsRefreshed();
		expect(store.getState().sessionsRefreshed).toBe(true);
	});
});
