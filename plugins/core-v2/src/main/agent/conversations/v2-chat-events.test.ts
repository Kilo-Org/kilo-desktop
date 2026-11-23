import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { applyKiloEvent, readChatInfo, type ChatRecords } from "./activity";
import { UserMessageTracker } from "./user-messages";
import { toV1Session, translateEvent, type ReadSession } from "./v2-chat-events";

const session: SessionInfo = {
	id: "ses_a",
	projectID: "prj",
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	time: { created: 1, updated: 2 },
	title: "Fix login",
	metadata: { "kilo-desktop": {} },
	location: { directory: "/projects/app" },
} as SessionInfo;

const LOCATION = { directory: "/projects/app" };

function event(type: string, data: Record<string, unknown>, location = LOCATION): OpenCodeEvent {
	return { id: "evt", created: 0, type, data, location } as unknown as OpenCodeEvent;
}

const readSession: ReadSession = async (id) =>
	id === "ses_a" ? session : id === "ses_child" ? { ...session, id, parentID: "ses_a" } : undefined;

async function translate(type: string, data: Record<string, unknown>) {
	return translateEvent(event(type, data), readSession);
}

describe("toV1Session", () => {
	it("reads as a chat in its location's directory", () => {
		expect(
			readChatInfo(toV1Session({ ...session, time: { created: 1, updated: 2, archived: 3 } })),
		).toEqual({
			id: "ses_a",
			title: "Fix login",
			parentId: null,
			directory: "/projects/app",
			metadata: { "kilo-desktop": {} },
			createdAt: 1,
			updatedAt: 2,
			archivedAt: 3,
		});
	});
});

describe("translateEvent", () => {
	it("announces a created, forked or changed session with the session read again", async () => {
		const created = await translate("session.created", { sessionID: "ses_a" });
		expect(created).toEqual([
			{
				type: "session.created",
				properties: { info: toV1Session(session) },
				directory: "/projects/app",
			},
		]);
		expect(
			(await translate("session.forked", { sessionID: "ses_child", parentID: "ses_a" }))[0],
		).toMatchObject({
			type: "session.created",
			properties: { info: { id: "ses_child", parentID: "ses_a" } },
		});
		for (const type of [
			"session.renamed",
			"session.metadata.updated",
			"session.archived",
			"session.unarchived",
		]) {
			expect((await translate(type, { sessionID: "ses_a" }))[0]?.type).toBe("session.updated");
		}
		await expect(translate("session.renamed", { sessionID: "ses_gone" })).resolves.toEqual([]);
	});

	it("turns an execution into busy, then idle, with a failure as the chat's error", async () => {
		const chats = async (types: [string, Record<string, unknown>][]) => {
			let records: ChatRecords = {};
			for (const [type, data] of types) {
				for (const translated of await translate(type, data)) {
					records = applyKiloEvent(records, translated, 10);
				}
			}
			return records.ses_a?.activity;
		};

		await expect(
			chats([["session.execution.started", { sessionID: "ses_a" }]]),
		).resolves.toMatchObject({
			status: "busy",
		});
		await expect(
			chats([
				["session.execution.started", { sessionID: "ses_a" }],
				["session.retry.scheduled", { sessionID: "ses_a" }],
				["session.execution.succeeded", { sessionID: "ses_a" }],
			]),
		).resolves.toMatchObject({ status: "idle", completedAt: 10 });
		await expect(
			chats([
				["session.execution.started", { sessionID: "ses_a" }],
				[
					"session.execution.failed",
					{ sessionID: "ses_a", error: { type: "provider.no-route", message: "No route" } },
				],
			]),
		).resolves.toMatchObject({
			status: "idle",
			lastError: { name: "provider.no-route", message: "No route" },
		});
	});

	it("tracks permission requests and forms as pending prompts", async () => {
		let records: ChatRecords = {};
		const apply = async (type: string, data: Record<string, unknown>) => {
			for (const translated of await translate(type, data))
				records = applyKiloEvent(records, translated, 0);
		};
		await apply("permission.asked", {
			id: "per_1",
			sessionID: "ses_a",
			action: "shell",
			resources: ["ls"],
		});
		await apply("form.created", {
			form: { id: "frm_1", sessionID: "ses_a", title: "Q", fields: [] },
		});
		await apply("form.created", {
			form: { id: "frm_2", sessionID: "ses_a", title: "Q", fields: [] },
		});
		expect(records.ses_a?.activity).toMatchObject({
			pendingPermissionIds: ["per_1"],
			pendingQuestionIds: ["frm_1", "frm_2"],
		});

		await apply("permission.replied", { sessionID: "ses_a", requestID: "per_1", reply: "once" });
		await apply("form.replied", { id: "frm_1", sessionID: "ses_a", answer: {} });
		await apply("form.cancelled", { id: "frm_2", sessionID: "ses_a" });
		expect(records.ses_a?.activity).toMatchObject({
			pendingPermissionIds: [],
			pendingQuestionIds: [],
		});
	});

	it("announces a person's prompt once from the session's inbox, never a synthetic note", async () => {
		const tracker = new UserMessageTracker();
		const observed = async (item: Record<string, unknown>) =>
			(await translate("session.inbox.enqueued", { sessionID: "ses_a", inboxID: "msg_1", item }))
				.map((translated) => tracker.observe(translated))
				.filter(Boolean);

		await expect(observed({ type: "synthetic", payload: { text: "note" } })).resolves.toEqual([]);
		await expect(observed({ type: "user", payload: { text: "Fix it" } })).resolves.toEqual([
			{ chatId: "ses_a", messageId: "msg_1", text: "Fix it" },
		]);
		await expect(observed({ type: "user", payload: { text: "Fix it" } })).resolves.toEqual([]);
	});

	it("passes deletions, the connection and drain acknowledgements through, and drops the rest", async () => {
		await expect(translate("session.deleted", { sessionID: "ses_a" })).resolves.toEqual([
			{ type: "session.deleted", properties: { sessionID: "ses_a" }, directory: "/projects/app" },
		]);
		await expect(
			translateEvent(
				{ ...event("server.connected", {}), location: undefined } as OpenCodeEvent,
				readSession,
			),
		).resolves.toEqual([{ type: "server.connected", properties: {} }]);
		await expect(
			translate("rpc.kilocode.session-drain.drained", { sessionID: "ses_a", token: "t" }),
		).resolves.toEqual([
			{
				type: "session.drained",
				properties: { sessionID: "ses_a", token: "t" },
				directory: "/projects/app",
			},
		]);
		await expect(
			translate("session.text.delta", { sessionID: "ses_a", delta: "x" }),
		).resolves.toEqual([]);
	});
});
