import { describe, expect, it, vi } from "vitest";

import { hydrateSessionActivity } from "./hydrate-session-activity.js";
import { createSessionActivityStore } from "./session-activity-store.js";

describe("hydrateSessionActivity", () => {
	it("seeds pending requests and statuses from successful endpoints", async () => {
		const store = createSessionActivityStore({ storage: null });
		const client = {
			permission: {
				list: vi.fn(async () => ({
					data: [{ id: "perm-1", sessionID: "ses-1" }],
				})),
			},
			question: {
				list: vi.fn(async () => ({
					data: [{ id: "q-1", sessionID: "ses-2" }],
				})),
			},
			session: {
				status: vi.fn(async () => ({
					data: { "ses-1": { type: "busy" } },
				})),
			},
		};

		await hydrateSessionActivity(client, store);

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-1"]);
		expect(store.getState().sessions["ses-2"]?.pendingQuestionIds).toEqual(["q-1"]);
		expect(store.getState().sessions["ses-1"]?.status).toBe("busy");
	});

	it("tolerates individual endpoint failures and missing data", async () => {
		const store = createSessionActivityStore({ storage: null });
		const client = {
			permission: {
				list: vi.fn(async () => {
					throw new Error("permission offline");
				}),
			},
			question: {
				list: vi.fn(async () => {
					throw new Error("question offline");
				}),
			},
			session: {
				status: vi.fn(async () => {
					throw new Error("status offline");
				}),
			},
		};

		await expect(hydrateSessionActivity(client, store)).resolves.toBeUndefined();
		expect(store.getState().sessions).toEqual({});
	});

	it("hydrates empty pending lists when endpoints omit data", async () => {
		const store = createSessionActivityStore({ storage: null });
		const client = {
			permission: { list: vi.fn(async () => ({})) },
			question: { list: vi.fn(async () => ({})) },
			session: { status: vi.fn(async () => ({})) },
		};

		await hydrateSessionActivity(client, store);

		expect(store.getState().sessions).toEqual({});
	});

	it("preserves one pending request type when only its endpoint fails", async () => {
		const store = createSessionActivityStore({ storage: null });
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "ses-1" },
		});
		store.getState().applyEvent({
			type: "question.asked",
			properties: { id: "question-1", sessionID: "ses-1" },
		});
		const client = {
			permission: {
				list: vi.fn(async () => {
					throw new Error("permission offline");
				}),
			},
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({})) },
		};

		await hydrateSessionActivity(client, store);

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-1"]);
		expect(store.getState().sessions["ses-1"]?.pendingQuestionIds).toEqual([]);
	});
});
