import { describe, expect, it, vi } from "vitest";

import { createDeferredKiloRuntimeClient } from "../runtime/create-deferred-kilo-runtime-client.js";
import { hydratePromptAncestry, hydrateSessionActivity } from "./hydrate-session-activity.js";
import { withDescendantPrompts } from "./session-activity-logic.js";
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

	it("keeps a live ask that races an empty hydration snapshot", async () => {
		const store = createSessionActivityStore({ storage: null });
		let resolvePermissions!: (value: { data: { id: string; sessionID: string }[] }) => void;
		const client = {
			permission: {
				list: vi.fn(
					() =>
						new Promise<{ data: { id: string; sessionID: string }[] }>((resolve) => {
							resolvePermissions = resolve;
						}),
				),
			},
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({})) },
		};

		const hydration = hydrateSessionActivity(client, store);
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-live", sessionID: "ses-1" },
		});
		resolvePermissions({ data: [] });
		await hydration;

		expect(store.getState().sessions["ses-1"]?.pendingPermissionIds).toEqual(["perm-live"]);
	});

	it("links subagent sessions holding recovered prompts to their chat", async () => {
		const store = createSessionActivityStore({ storage: null });
		const parents: Record<string, string | undefined> = {
			grandchild: "child",
			child: "root",
			root: undefined,
		};
		const get = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
			data: { id: sessionID, parentID: parents[sessionID] },
		}));
		const client = {
			permission: {
				list: vi.fn(async () => ({ data: [{ id: "perm-1", sessionID: "grandchild" }] })),
			},
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({ data: {} })), get },
		};

		await hydrateSessionActivity(client, store);

		const sessions = store.getState().sessions;
		expect(sessions.grandchild?.parentId).toBe("child");
		expect(sessions.child?.parentId).toBe("root");
		expect(withDescendantPrompts(sessions).root?.pendingPermissionIds).toEqual(["perm-1"]);
		expect(get.mock.calls.map(([input]) => input.sessionID)).toEqual([
			"grandchild",
			"child",
			"root",
		]);
	});
});

describe("hydratePromptAncestry", () => {
	it("does not touch a deferred client when no session awaits a parent lookup", async () => {
		const store = createSessionActivityStore({ storage: null });
		const loadClient = vi.fn(async () => {
			throw new Error("Kilo Server requires the desktop app.");
		});

		await hydratePromptAncestry(createDeferredKiloRuntimeClient(loadClient), store);

		expect(loadClient).not.toHaveBeenCalled();
	});

	it("resolves parent links through a deferred client", async () => {
		const store = createSessionActivityStore({ storage: null });
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "child" },
		});
		const get = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
			data: { id: sessionID, parentID: sessionID === "child" ? "root" : undefined },
		}));

		await hydratePromptAncestry(
			createDeferredKiloRuntimeClient(async () => ({ session: { get } }) as never),
			store,
		);

		expect(store.getState().sessions.child?.parentId).toBe("root");
	});

	it("resolves the rest of the chain above a prompting session whose own parent is known", async () => {
		const store = createSessionActivityStore({ storage: null });
		// The nested subagent's link arrived live; its parent predates the connection.
		store.getState().hydrateSessions([{ id: "grandchild", parentId: "child" }]);
		store.getState().applyEvent({
			type: "permission.asked",
			properties: { id: "perm-1", sessionID: "grandchild" },
		});
		const parents: Record<string, string | undefined> = { child: "root", root: undefined };
		const get = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
			data: { id: sessionID, parentID: parents[sessionID] },
		}));
		const client = {
			permission: { list: vi.fn(async () => ({ data: [] })) },
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({ data: {} })), get },
		};

		await hydratePromptAncestry(client, store);

		expect(get.mock.calls.map(([input]) => input.sessionID)).toEqual(["child", "root"]);
		expect(withDescendantPrompts(store.getState().sessions).root?.pendingPermissionIds).toEqual([
			"perm-1",
		]);
	});
});
