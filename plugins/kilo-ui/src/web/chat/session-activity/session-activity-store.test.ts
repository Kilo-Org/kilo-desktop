import { describe, expect, it } from "vitest";

import { createSessionActivityStore, LAST_VISITED_STORAGE_KEY } from "./session-activity-store.js";

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
		});

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual([]);
		expect(store.getState().sessions["ses-1"]?.pendingQuestionIds).toEqual(["q-1"]);
		expect(store.getState().sessions["ses-2"]?.pendingPermissionIds).toEqual(["perm-2"]);
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
});
