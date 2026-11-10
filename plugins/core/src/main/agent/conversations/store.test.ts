import { describe, expect, it } from "vitest";

import type { ChatInfo, KiloEvent } from "./activity";
import { ConversationStore } from "./store";

const NOW = 1_700_000_000_000;

function info(id: string, overrides: Partial<ChatInfo> = {}): ChatInfo {
	return {
		id,
		title: `Chat ${id}`,
		parentId: null,
		directory: "/repo",
		metadata: { "kilo-desktop": {} },
		createdAt: 10,
		updatedAt: 20,
		...overrides,
	};
}

const status = (sessionID: string, type: string): KiloEvent => ({
	type: "session.status",
	properties: { sessionID, status: { type } },
});
const asked = (kind: "permission" | "question", id: string, sessionID: string): KiloEvent => ({
	type: `${kind}.asked`,
	properties: { id, sessionID },
});
const replied = (requestID: string, sessionID: string): KiloEvent => ({
	type: "permission.replied",
	properties: { requestID, sessionID },
});

function storeAt(now = NOW) {
	let clock = now;
	const store = new ConversationStore(() => clock);
	return { store, setNow: (next: number) => (clock = next) };
}

describe("the conversation store", () => {
	it("counts live changes, not ignored events", () => {
		const { store } = storeAt();

		expect(store.apply(status("ses-1", "busy"))).toBe(true);
		expect(store.apply({ type: "message.updated", properties: {} })).toBe(false);
		expect(store.epoch).toBe(1);
	});

	it("keeps live activity when the list is read", () => {
		const { store } = storeAt();
		store.apply(asked("question", "q-1", "ses-1"));

		store.replaceRoots([info("ses-1")], store.epoch);

		expect(store.chats["ses-1"]).toMatchObject({
			info: info("ses-1"),
			activity: { pendingQuestionIds: ["q-1"] },
		});
	});

	it("drops roots the server no longer lists, with their subagents", () => {
		const { store } = storeAt();
		store.replaceRoots([info("gone"), info("kept")], store.epoch);
		store.addInfos([info("child", { parentId: "gone" }), info("kidOfKept", { parentId: "kept" })]);

		store.replaceRoots([info("kept")], store.epoch);

		expect(Object.keys(store.chats).sort()).toEqual(["kept", "kidOfKept"]);
	});

	it("keeps what live events changed while the list was read", () => {
		const { store } = storeAt();
		store.replaceRoots([info("deleted"), info("renamed")], store.epoch);
		const since = store.epoch;
		store.apply({ type: "session.created", properties: { info: rawInfo("fresh") } });
		store.apply({ type: "session.deleted", properties: { info: { id: "deleted" } } });
		store.apply({
			type: "session.updated",
			properties: {
				info: rawInfo("renamed", { title: "New", time: { created: 10, updated: 99 } }),
			},
		});

		store.replaceRoots([info("deleted"), info("renamed", { title: "Old" })], since);

		expect(Object.keys(store.chats).sort()).toEqual(["fresh", "renamed"]);
		expect(store.chats.renamed?.info?.title).toBe("New");
	});

	it("never replaces newer info with an older lookup", () => {
		const { store } = storeAt();
		store.addInfos([info("a", { updatedAt: 50, title: "New" })]);

		store.addInfos([info("a", { updatedAt: 40, title: "Old" })]);

		expect(store.chats.a?.info?.title).toBe("New");
	});

	describe("pending prompts read on (re)connect", () => {
		it("replace what was pending", () => {
			const { store } = storeAt();
			store.apply(asked("permission", "perm-stale", "ses-1"));

			store.hydrateActivity(
				{
					permissions: { requests: [{ id: "perm-2", sessionID: "ses-2" }], complete: true },
					questions: { requests: [{ id: "q-1", sessionID: "ses-1" }], complete: true },
				},
				store.epoch,
			);

			expect(store.chats["ses-1"]?.activity).toMatchObject({
				pendingPermissionIds: [],
				pendingQuestionIds: ["q-1"],
			});
			expect(store.chats["ses-2"]?.activity.pendingPermissionIds).toEqual(["perm-2"]);
		});

		it("are merged when live events raced the read, or a directory couldn't be read", () => {
			const { store } = storeAt();
			const since = store.epoch;
			store.apply(asked("permission", "perm-live", "ses-1"));

			store.hydrateActivity(
				{ permissions: { requests: [{ id: "perm-snap", sessionID: "ses-2" }], complete: true } },
				since,
			);
			store.hydrateActivity({ questions: { requests: [], complete: false } }, store.epoch);

			expect(store.chats["ses-1"]?.activity.pendingPermissionIds).toEqual(["perm-live"]);
			expect(store.chats["ses-2"]?.activity.pendingPermissionIds).toEqual(["perm-snap"]);
		});

		it("never bring back a permission a live reply cleared during the read", () => {
			const { store } = storeAt();
			store.apply(asked("permission", "perm-1", "ses-1"));
			const since = store.epoch;
			store.apply(replied("perm-1", "ses-1"));

			store.hydrateActivity(
				{ permissions: { requests: [{ id: "perm-1", sessionID: "ses-1" }], complete: true } },
				since,
			);

			expect(store.chats["ses-1"]?.activity.pendingPermissionIds).toEqual([]);
		});

		it("remember where each chat's prompt was read", () => {
			const { store } = storeAt();

			store.hydrateActivity(
				{
					questions: { requests: [{ id: "q", sessionID: "ses-1" }], complete: true },
					directories: { "ses-1": "/elsewhere" },
				},
				store.epoch,
			);

			expect(store.chats["ses-1"]?.directory).toBe("/elsewhere");
		});
	});

	describe("statuses read on (re)connect", () => {
		it("stamp workingSince for busy chats and ignore idle unknown ones", () => {
			const { store } = storeAt();

			store.hydrateActivity(
				{
					statuses: {
						byChat: { "ses-1": { type: "busy" }, "ses-2": { type: "idle" } },
						complete: true,
					},
				},
				store.epoch,
			);

			expect(store.chats["ses-1"]?.activity).toMatchObject({ status: "busy", workingSince: NOW });
			expect(store.chats["ses-2"]).toBeUndefined();
		});

		it("keep the original workingSince when repeated while busy", () => {
			const { store, setNow } = storeAt();
			const busy = { statuses: { byChat: { "ses-1": { type: "busy" } }, complete: true } };
			store.hydrateActivity(busy, store.epoch);

			setNow(NOW + 60_000);
			store.hydrateActivity(busy, store.epoch);

			expect(store.chats["ses-1"]?.activity.workingSince).toBe(NOW);
		});

		it("settle working chats the server no longer lists as working", () => {
			const { store } = storeAt();
			store.apply(status("ses-1", "busy"));
			store.apply(status("ses-2", "busy"));

			store.hydrateActivity(
				{ statuses: { byChat: { "ses-1": { type: "idle" } }, complete: true } },
				store.epoch,
			);

			expect(store.chats["ses-1"]?.activity).toMatchObject({
				status: "idle",
				workingSince: undefined,
			});
			expect(store.chats["ses-1"]?.activity.completedAt).toBeUndefined();
			expect(store.chats["ses-2"]?.activity.status).toBe("idle");
		});

		it("leave unlisted working chats alone when the read was partial or raced", () => {
			const { store } = storeAt();
			store.apply(status("ses-1", "busy"));
			const since = store.epoch;
			store.apply(status("ses-2", "busy"));

			store.hydrateActivity({ statuses: { byChat: {}, complete: false } }, store.epoch);
			store.hydrateActivity({ statuses: { byChat: {}, complete: true } }, since);

			expect(store.chats["ses-1"]?.activity.status).toBe("busy");
			expect(store.chats["ses-2"]?.activity.status).toBe("busy");
		});

		it("don't bring back busy after a live completion during the read", () => {
			const { store } = storeAt();
			const since = store.epoch;
			store.apply(status("ses-1", "busy"));
			store.apply(status("ses-1", "idle"));

			store.hydrateActivity(
				{ statuses: { byChat: { "ses-1": { type: "busy" } }, complete: true } },
				since,
			);

			expect(store.chats["ses-1"]?.activity).toMatchObject({ status: "idle", completedAt: NOW });
		});

		it("may mark busy again on a clean reconnect after a completion", () => {
			const { store } = storeAt();
			store.apply(status("ses-1", "busy"));
			store.apply(status("ses-1", "idle"));

			store.hydrateActivity(
				{ statuses: { byChat: { "ses-1": { type: "busy" } }, complete: true } },
				store.epoch,
			);

			expect(store.chats["ses-1"]?.activity).toMatchObject({
				status: "busy",
				workingSince: NOW,
				completedAt: undefined,
			});
		});
	});

	it("settles everything when the server goes away", () => {
		const { store } = storeAt();
		store.apply(status("ses-1", "busy"));
		store.apply(asked("permission", "p", "ses-1"));

		store.resetActivity();

		expect(store.chats["ses-1"]?.activity).toMatchObject({
			status: "idle",
			pendingPermissionIds: [],
		});
	});
});

function rawInfo(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Chat ${id}`,
		directory: "/repo",
		metadata: { "kilo-desktop": {} },
		time: { created: 10, updated: 20 },
		...overrides,
	};
}
