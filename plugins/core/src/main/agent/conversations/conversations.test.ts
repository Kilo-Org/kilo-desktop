import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { KernelServices, type DecisionAnswer, type PluginRegistration } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import {
	ChatConfigPoint,
	Chats,
	Generation,
	SERVER_SERVICE_KEY,
	Tool,
	ToolApproval,
} from "../../../contracts";
import { bootAgent, cleanUpAgents, eventually, tempDir } from "../../../test/agent/boot";
import {
	createdEvent,
	desktopChat,
	event,
	FakeKiloChats,
} from "../../../test/agent/fake-kilo-chats";
import { FakeServer } from "../../../test/agent/fake-server";
import { withWorktreeBranch } from ".";
import type { CreateChatParams } from "./kilo-chat-client";

afterEach(cleanUpAgents);

async function boot(
	options: {
		chats?: FakeKiloChats;
		plugins?: readonly PluginRegistration[];
		holdServer?: boolean;
		/** A folder an earlier boot used, to boot again as after a restart. */
		root?: string;
	} = {},
) {
	const root = options.root ?? (await tempDir("kilo-conversations-"));
	const chats = options.chats ?? new FakeKiloChats();
	let server: FakeServer | undefined;
	let release = () => {};
	const { kernel, failingStorage } = await bootAgent({
		chats,
		plugins: options.plugins ?? [],
		showWindow: false,
		// Nested as in the app, so the unscoped chats folder lands inside `root`.
		storage: path.join(root, "plugins", "kilo.core"),
		agent: {
			createServer: (input) => {
				server = new FakeServer(input);
				if (options.holdServer) {
					server.startGate = new Promise<void>((resolve) => (release = resolve));
				}
				return server;
			},
			chatReconnectDelayMs: 5,
		},
	});
	// Not awaited: window-shown services (analytics) never hold the test; the server starts on activation.
	void kernel.windowShown();
	const conversations = kernel.kernelSdk.domainObjects.get(Chats)!;
	const generation = kernel.kernelSdk.domainObjects.get(Generation)!;
	const events: string[] = [];
	const record =
		(name: string) =>
		(payload: { chat?: { id: string }; after?: { id: string }; chatId?: string }) =>
			events.push(`${name} ${payload.chat?.id ?? payload.after?.id ?? payload.chatId}`);
	conversations.on("created", record("created"));
	conversations.on("updated", record("updated"));
	conversations.on("deleted", record("deleted"));
	conversations.on("listed", () => events.push("listed"));
	conversations.on("turn-started", record("turn-started"));
	conversations.on("turn-ended", (payload) =>
		events.push(`turn-ended ${payload.chatId}${payload.error ? ` ${payload.error.message}` : ""}`),
	);
	conversations.on("permission-requested", (payload) =>
		events.push(`permission-requested ${payload.chatId} ${payload.permissionId}`),
	);
	conversations.on("permission-resolved", (payload) =>
		events.push(`permission-resolved ${payload.chatId} ${payload.permissionId}`),
	);
	conversations.on("question-requested", (payload) =>
		events.push(`question-requested ${payload.chatId} ${payload.questionId}`),
	);
	conversations.on("question-resolved", (payload) =>
		events.push(`question-resolved ${payload.chatId} ${payload.questionId}`),
	);
	const state = () => conversations.getState();
	const whenReady = () => eventually(() => expect(state().ready).toBe(true));
	return {
		root,
		kernel,
		conversations,
		generation,
		chats,
		failingStorage,
		events,
		state,
		whenReady,
		server: () => server!,
		release: () => release(),
	};
}

const started = (sessionID: string) => event("session.execution.started", { sessionID });
const succeeded = (sessionID: string) => event("session.execution.succeeded", { sessionID });
const interrupted = (sessionID: string) =>
	event("session.execution.interrupted", { sessionID, reason: "user" });
const failed = (sessionID: string, message: string) =>
	event("session.execution.failed", { sessionID, error: { type: "provider", message } });
const renamed = (sessionID: string, title: string) =>
	event("session.renamed", { sessionID, title });
const drained = (sessionID: string, token: string) =>
	event("rpc.kilocode.session-drain.drained", { sessionID, token });
const questionForm = (id: string, sessionID: string) =>
	event("form.created", {
		form: { id, sessionID, title: "Questions", metadata: { kind: "question" } },
	});

/** Drops the event stream and waits until kilo.core has reconnected and read the list again. */
async function reread(chats: FakeKiloChats, events: string[]) {
	const listed = events.filter((name) => name === "listed").length;
	chats.end();
	await eventually(() =>
		expect(events.filter((name) => name === "listed").length).toBeGreaterThan(listed),
	);
}

describe("chat work completion", () => {
	it.each(["ses_child", "ses_a"])(
		"completes after stopping %s without another root turn",
		async (stopped) => {
			const chats = new FakeKiloChats();
			chats.chats = [desktopChat("ses_a"), desktopChat("ses_child", { parentId: "ses_a" })];
			chats.running = ["ses_child"];
			const { conversations, whenReady, state } = await boot({ chats });
			await whenReady();
			const completed: string[] = [];
			conversations.on("work-completed", ({ chatId }) => completed.push(chatId));

			chats.push(started("ses_a"));
			chats.push(succeeded("ses_a"));
			await eventually(() => expect(chats.drainRequests).toHaveLength(1));
			const request = chats.drainRequests[0]!;
			expect(request).toMatchObject({ directory: "/projects/app", id: "ses_a" });
			request.resolve();
			await conversations.methods.abort({ id: stopped });
			chats.push(interrupted(stopped));
			chats.push(succeeded("ses_child"));
			await eventually(() => expect(state().chats.ses_child?.activity.status).toBe("idle"));
			expect(completed).toEqual([]);

			chats.push(drained("ses_a", request.token));
			await eventually(() => expect(completed).toEqual(["ses_a"]));
			expect(chats.drainRequests).toHaveLength(1);
		},
	);

	it("coalesces queued report turns and accepts each matching acknowledgment only once", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { conversations, whenReady, events, state } = await boot({ chats });
		await whenReady();
		const completed: string[] = [];
		conversations.on("work-completed", ({ chatId }) => completed.push(chatId));
		chats.push(started("ses_a"));
		chats.push(succeeded("ses_a"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(1));
		const first = chats.drainRequests[0]!;
		first.resolve();
		for (let report = 0; report < 2; report++) {
			chats.push(started("ses_a"));
			chats.push(succeeded("ses_a"));
		}
		chats.push(drained("ses_a", first.token));
		chats.push(drained("ses_a", first.token));
		chats.push(renamed("ses_a", "Finished"));
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Finished"));
		expect(events.filter((name) => name === "turn-ended ses_a")).toHaveLength(3);
		expect(chats.drainRequests).toHaveLength(1);
		expect(completed).toEqual(["ses_a"]);
	});

	it("discards an acknowledgment overtaken by a new turn and waits again when that turn ends", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		const completed: string[] = [];
		conversations.on("work-completed", ({ chatId }) => completed.push(chatId));
		chats.push(started("ses_a"));
		chats.push(succeeded("ses_a"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(1));
		const first = chats.drainRequests[0]!;
		chats.push(started("ses_a"));
		chats.push(drained("ses_a", first.token));
		chats.push(renamed("ses_a", "Still working"));
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Still working"));
		expect(completed).toEqual([]);
		expect(first.signal.aborted).toBe(true);
		chats.push(succeeded("ses_a"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(2));
		chats.push(drained("ses_a", chats.drainRequests[1]!.token));
		await eventually(() => expect(completed).toEqual(["ses_a"]));
	});

	it.each(["turn error", "late error", "deletion", "server stop", "disposal", "request failure"])(
		"suppresses pending success after %s",
		async (cause) => {
			const chats = new FakeKiloChats();
			chats.chats = [desktopChat("ses_a"), desktopChat("ses_marker")];
			const { conversations, whenReady, state, kernel, server } = await boot({ chats });
			await whenReady();
			const completed: string[] = [];
			conversations.on("work-completed", ({ chatId }) => completed.push(chatId));
			chats.push(started("ses_a"));
			chats.push(succeeded("ses_a"));
			await eventually(() => expect(chats.drainRequests).toHaveLength(1));
			const request = chats.drainRequests[0]!;
			if (cause === "turn error") {
				chats.push(started("ses_a"));
				chats.push(failed("ses_a", "Failed"));
			} else if (cause === "late error") {
				chats.push(failed("ses_a", "Failed"));
			} else if (cause === "deletion") {
				await conversations.methods.delete({ id: "ses_a" });
			} else if (cause === "server stop") {
				server().crash("gone");
				await eventually(() => expect(state().ready).toBe(false));
			} else if (cause === "disposal") {
				await kernel.stop();
			} else {
				request.reject(new Error("drain refused"));
			}
			await eventually(() => expect(request.signal.aborted).toBe(true));
			chats.push(drained("ses_a", request.token));
			if (cause === "server stop") {
				await kernel.kernelSdk.domainObjects
					.get(KernelServices)!
					.methods.restart({ key: SERVER_SERVICE_KEY });
				await whenReady();
			}
			if (cause !== "disposal") {
				chats.push(renamed("ses_marker", "Observed"));
				await eventually(() => expect(state().chats.ses_marker?.title).toBe("Observed"));
			}
			expect(completed).toEqual([]);
			expect(chats.drainRequests).toHaveLength(1);
		},
	);

	it("rearms only pending live work after reconnect hydration and ignores the old token", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_startup")];
		chats.running = ["ses_startup"];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		const completed: string[] = [];
		conversations.on("work-completed", ({ chatId }) => completed.push(chatId));
		expect(chats.drainRequests).toEqual([]);
		chats.push(started("ses_a"));
		chats.push(succeeded("ses_a"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(1));
		const first = chats.drainRequests[0]!;
		let releaseHydration = () => {};
		const hydration = new Promise<void>((resolve) => (releaseHydration = resolve));
		const list = chats.listChats.bind(chats);
		chats.listChats = async () => {
			await hydration;
			return list();
		};
		chats.end();
		await eventually(() => expect(chats.subscriptions).toBe(2));
		expect(first.signal.aborted).toBe(true);
		expect(chats.drainRequests).toHaveLength(1);
		chats.push(drained("ses_a", first.token));
		releaseHydration();
		await eventually(() => expect(chats.drainRequests).toHaveLength(2));
		const second = chats.drainRequests[1]!;
		expect(second.id).toBe("ses_a");
		expect(second.token).not.toBe(first.token);
		second.resolve();
		first.reject(new Error("old transport failed"));
		chats.push(drained("ses_a", first.token));
		chats.push(renamed("ses_a", "Reconnected"));
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Reconnected"));
		expect(completed).toEqual([]);
		expect(second.signal.aborted).toBe(false);
		chats.push(drained("ses_a", second.token));
		await eventually(() => expect(completed).toEqual(["ses_a"]));
	});
});

describe("following the server's chats", () => {
	it("lists this app's chats and their subagents once the server is ready", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_cli", { metadata: {} })];
		const { state, whenReady, release, events } = await boot({ chats, holdServer: true });
		expect(state()).toEqual({ ready: false, chats: {}, declinedSignInTools: [] });

		release();
		await whenReady();

		expect(Object.keys(state().chats)).toEqual(["ses_a"]);
		expect(state().chats.ses_a).toMatchObject({
			title: "Chat ses_a",
			directory: "/projects/app",
			workspaceId: "w1",
			activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		});
		await eventually(() => expect(events).toEqual(["listed"]));
	});

	it("reads what is running and what running chats wait on when it connects", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_b"), desktopChat("ses_c")];
		chats.running = ["ses_a", "ses_b"];
		chats.permissions.ses_b = [
			{ id: "per_1", chatId: "ses_b", action: "shell", resources: ["ls"], metadata: {} },
		];
		chats.questions.ses_b = ["frm_1"];

		const { state, whenReady } = await boot({ chats });
		await whenReady();

		expect(state().chats.ses_a?.activity).toMatchObject({ status: "busy" });
		expect(state().chats.ses_b?.activity).toMatchObject({
			status: "busy",
			pendingPermissionIds: ["per_1"],
			pendingQuestionIds: ["frm_1"],
		});
		expect(state().chats.ses_c?.activity.status).toBe("idle");
		// Only running chats can wait on a prompt.
		expect(chats.reads).not.toContain("permissions ses_c");
	});

	it("announces live changes, turns and prompts", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		events.length = 0;

		chats.push(createdEvent(desktopChat("ses_b")));
		chats.push(renamed("ses_a", "Renamed"));
		chats.push(started("ses_a"));
		chats.push(event("permission.asked", { id: "per_1", sessionID: "ses_a", action: "shell" }));
		chats.push(
			event("permission.replied", { requestID: "per_1", sessionID: "ses_a", reply: "once" }),
		);
		chats.push(questionForm("frm_1", "ses_a"));
		chats.push(
			event("form.created", { form: { id: "frm_other", sessionID: "ses_a", metadata: {} } }),
		);
		chats.push(event("form.cancelled", { id: "frm_1", sessionID: "ses_a" }));
		chats.push(failed("ses_a", "Down"));
		chats.push(event("session.deleted", { sessionID: "ses_b" }));

		await eventually(() => expect(events).toContain("deleted ses_b"));
		expect(state().chats.ses_b).toBeUndefined();
		expect(events.filter((name) => !name.startsWith("updated"))).toEqual([
			"created ses_b",
			"turn-started ses_a",
			"permission-requested ses_a per_1",
			"permission-resolved ses_a per_1",
			"question-requested ses_a frm_1",
			"question-resolved ses_a frm_1",
			"turn-ended ses_a Down",
			"deleted ses_b",
		]);
		expect(state().chats.ses_a).toMatchObject({
			title: "Renamed",
			activity: { status: "idle", lastError: { name: "provider", message: "Down" } },
		});
	});

	it("follows a retry until the next step starts, as one turn", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();

		chats.push(started("ses_a"));
		chats.push(event("session.retry.scheduled", { sessionID: "ses_a", attempt: 1 }));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("retry"));
		const since = state().chats.ses_a?.activity.workingSince;
		chats.push(event("session.step.started", { sessionID: "ses_a" }));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		chats.push(succeeded("ses_a"));

		await eventually(() => expect(events).toContain("turn-ended ses_a"));
		expect(state().chats.ses_a?.activity.workingSince).toBeUndefined();
		expect(since).toEqual(expect.any(Number));
		expect(events.filter((name) => name === "turn-started ses_a")).toHaveLength(1);
	});

	it("follows archiving, metadata and moves", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady } = await boot({ chats });
		await whenReady();

		chats.push(event("session.archived", { sessionID: "ses_a" }, { created: 5_000 }));
		await eventually(() => expect(state().chats.ses_a?.archivedAt).toBe(5_000));
		chats.push(event("session.unarchived", { sessionID: "ses_a" }));
		chats.push(
			event("session.metadata.updated", {
				sessionID: "ses_a",
				metadata: { "kilo-desktop": { workspaceId: "w2" } },
			}),
		);
		chats.push(
			event("session.moved", { sessionID: "ses_a", location: { directory: "/projects/b" } }),
		);

		await eventually(() => expect(state().chats.ses_a?.directory).toBe("/projects/b"));
		expect(state().chats.ses_a).toMatchObject({ workspaceId: "w2" });
		expect(state().chats.ses_a).not.toHaveProperty("archivedAt");
	});

	it("reopens a dropped stream and reads everything again, announcing what changed", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		chats.push(started("ses_a"));
		chats.push(event("permission.asked", { id: "per_far", sessionID: "ses_far" }));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));

		chats.chats.push(desktopChat("ses_new"));
		chats.running = ["ses_far"];
		chats.permissions.ses_far = [
			{ id: "per_far", chatId: "ses_far", action: "shell", resources: [], metadata: {} },
		];
		await reread(chats, events);

		expect(state().chats.ses_new).toBeDefined();
		expect(chats.subscriptions).toBe(2);
		expect(state().ready).toBe(true);
		expect(state().chats.ses_a?.activity.status).toBe("idle");
		expect(chats.reads).toContain("permissions ses_far");
		expect(chats.reads).toContain("get ses_far");
		expect(events).toContain("created ses_new");
		expect(events.filter((name) => name.startsWith("turn-ended"))).toEqual([]);
	});

	it("keeps a chat renamed while the list was being read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		let releaseList = () => {};
		const list = chats.listChats.bind(chats);
		chats.listChats = async () => {
			const rows = await list();
			await new Promise<void>((resolve) => (releaseList = resolve));
			return rows;
		};
		chats.end();
		await eventually(() => expect(chats.subscriptions).toBe(2));
		chats.push(renamed("ses_a", "Renamed meanwhile"));
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Renamed meanwhile"));
		chats.listChats = list;
		releaseList();

		await eventually(() => expect(events.filter((name) => name === "listed")).toHaveLength(2));
		expect(state().chats.ses_a?.title).toBe("Renamed meanwhile");
	});

	it("keeps trying while the list can't be read", async () => {
		const chats = new FakeKiloChats();
		chats.failList = true;
		const { state, whenReady } = await boot({ chats });
		await eventually(() => expect(chats.listCalls).toBeGreaterThan(1));
		expect(state().ready).toBe(false);

		chats.failList = false;
		chats.chats = [desktopChat("ses_a")];

		await whenReady();
		expect(state().chats.ses_a).toBeDefined();
	});

	it("keeps what it knew about a waiting chat whose prompts can't be read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		chats.push(started("ses_a"));
		chats.push(event("permission.asked", { id: "per_1", sessionID: "ses_a" }));
		await eventually(() =>
			expect(state().chats.ses_a?.activity.pendingPermissionIds).toEqual(["per_1"]),
		);
		chats.running = ["ses_a"];
		chats.failing.add("permissionRequests");

		await reread(chats, events);

		expect(state().chats.ses_a?.activity.pendingPermissionIds).toEqual(["per_1"]);
	});

	it("settles activity while the server is down, and reads again when it is back", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { kernel, state, whenReady, server } = await boot({ chats });
		await whenReady();
		chats.push(started("ses_a"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		const listed = chats.listCalls;

		server().crash("gone");

		await eventually(() => expect(state().ready).toBe(false));
		expect(state().chats.ses_a?.activity.status).toBe("idle");
		await kernel.kernelSdk.domainObjects
			.get(KernelServices)!
			.methods.restart({ key: SERVER_SERVICE_KEY });
		await whenReady();
		expect(chats.listCalls).toBe(listed + 1);
	});

	it("looks up a waiting subagent's chat to learn whose it is", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		events.length = 0;
		chats.chats.push(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} }));

		chats.push(event("permission.asked", { id: "per_1", sessionID: "ses_sub" }));

		await eventually(() => expect(state().chats.ses_sub).toBeDefined());
		expect(state().chats.ses_sub).toMatchObject({
			parentId: "ses_a",
			workspaceId: "w1",
			activity: { pendingPermissionIds: ["per_1"] },
		});
		expect(events).toEqual(["created ses_sub", "permission-requested ses_sub per_1"]);
	});

	it("lists a subagent the server announces with its parent", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady } = await boot({ chats });
		await whenReady();

		chats.push(createdEvent(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} })));

		await eventually(() => expect(state().chats.ses_sub).toMatchObject({ parentId: "ses_a" }));
	});

	it("looks a subagent up again after the stream reopens, not waiting on the dropped stream's lookup", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady } = await boot({ chats });
		await whenReady();
		chats.chats.push(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} }));
		chats.running = ["ses_sub"];
		chats.permissions.ses_sub = [
			{ id: "per_1", chatId: "ses_sub", action: "shell", resources: [], metadata: {} },
		];
		const getChat = chats.getChat.bind(chats);
		let lookups = 0;
		chats.getChat = (id) => {
			lookups += 1;
			// The dropped stream's lookup never answers.
			return lookups === 1 ? new Promise(() => {}) : getChat(id);
		};

		chats.push(event("permission.asked", { id: "per_1", sessionID: "ses_sub" }));
		await eventually(() => expect(lookups).toBe(1));
		chats.end();

		await eventually(() => expect(state().chats.ses_sub).toMatchObject({ parentId: "ses_a" }));
	});

	it("tells which chats the server doesn't have", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_sub", { parentId: "ses_a" })];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.findMissing({ ids: ["ses_a", "ses_sub", "ses_gone", "ses_gone"] }),
		).resolves.toEqual({ missing: ["ses_gone"] });
		chats.failing.add("getChat");
		await expect(conversations.methods.findMissing({ ids: ["ses_unsure"] })).resolves.toEqual({
			missing: [],
		});
		expect(chats.reads.filter((read) => read === "get ses_a")).toEqual([]);
	});
});

/** A plugin with three tools, one that asks, plus approval and chat config contributions. */
function shapingPlugin(options: {
	approve?: (tool: string) => DecisionAnswer;
	failConfig?: boolean;
}) {
	const tool = { description: "x", input: z.object({}), run: () => null };
	return testPlugin("acme.tools", {
		manifest: {
			contributes: {
				extensions: {
					"kilo.core/tool": [
						{ id: "deploy", title: "Deploy", approval: "ask" },
						{ id: "list", title: "List" },
						{ id: "wipe", title: "Wipe" },
					],
					"kilo.core/tool-approval": [{ id: "policy" }],
					"kilo.core/chat-config": [{ id: "config" }, { id: "broken" }],
				},
			},
		},
		entry: {
			activate: (sdk) => {
				for (const id of ["deploy", "list", "wipe"]) sdk.extensions.implement(Tool, id, tool);
				sdk.extensions.implement(ToolApproval, "policy", ({ tool: name }) =>
					options.approve ? options.approve(name) : "proceed",
				);
				sdk.extensions.implement(ChatConfigPoint, "config", {
					configure: (context) => ({
						disableTools: ["desktop_notebook_open"],
						instructions: [
							`Chat ${context.chatId} of ${context.workSessionId}/${context.workspaceId} in ${context.directory}`,
						],
						permissions: [{ action: "shell", resource: "*conda install*", effect: "ask" }],
					}),
				});
				sdk.extensions.implement(ChatConfigPoint, "broken", {
					configure: () => {
						throw new Error("boom");
					},
				});
			},
		},
	});
}

describe("creating chats", () => {
	it("stamps this app's metadata and the permission rules tools and plugins ask for", async () => {
		const asked: string[] = [];
		const { conversations, chats, whenReady, events, state } = await boot({
			plugins: [
				shapingPlugin({
					approve: (tool) => {
						asked.push(tool);
						return tool === "acme.tools/wipe" ? { reject: "Never." } : "proceed";
					},
				}),
			],
		});
		await whenReady();
		events.length = 0;

		const chat = await conversations.methods.create({
			directory: "/projects/app",
			workSessionId: "wses_1",
			workspaceId: "w1",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
			worktreeBranch: "kilo/fix",
			agent: "code",
			model: { aiProviderId: "kilo", modelId: "m1", variant: "high" },
			title: "Fix login",
		});

		const [created] = chats.writes;
		expect(created?.call).toBe("create");
		expect(created?.args[0]).toBe("/projects/app");
		expect(created?.args[1]).toEqual({
			title: "Fix login",
			agent: "code",
			model: { providerID: "kilo", id: "m1", variant: "high" },
			metadata: {
				"kilo-desktop": {
					workspaceId: "w1",
					workspaceFolders: [
						{ path: "/projects/app", isPrimary: true },
						{ path: "/projects/lib", isPrimary: false },
					],
					worktree: { branch: "kilo/fix" },
					workSessionId: "wses_1",
				},
				"kilocode.sandbox": { enabled: false, version: 0 },
			},
			permissions: [
				{ action: "external_directory", resource: "/projects/lib", effect: "allow" },
				{ action: "external_directory", resource: "/projects/lib/*", effect: "allow" },
				{ action: "shell", resource: "*conda install*", effect: "ask" },
				{ action: "desktop_acme_tools_deploy", resource: "*", effect: "ask" },
				{ action: "desktop_notebook_open", resource: "*", effect: "deny" },
				{ action: "desktop_acme_tools_wipe", resource: "*", effect: "deny" },
			],
		} satisfies CreateChatParams);
		expect(asked.sort()).toEqual(["acme.tools/deploy", "acme.tools/list", "acme.tools/wipe"]);
		expect(chat).toMatchObject({
			id: "ses_new_1",
			title: "Fix login",
			workSessionId: "wses_1",
			worktreeBranch: "kilo/fix",
		});
		expect(state().chats[chat.id]).toEqual(chat);
		expect(events).toEqual([`created ${chat.id}`]);
	});

	it("keeps a chat created while the list was being read", async () => {
		const chats = new FakeKiloChats();
		const { conversations, state, whenReady, events } = await boot({ chats });
		await whenReady();
		let releaseList = () => {};
		const list = chats.listChats.bind(chats);
		chats.listChats = async () => {
			const rows = await list();
			await new Promise<void>((resolve) => (releaseList = resolve));
			return rows;
		};
		chats.end();
		await eventually(() => expect(chats.subscriptions).toBe(2));
		const chat = await conversations.methods.create({ directory: "/tmp" });
		chats.listChats = list;
		releaseList();

		await eventually(() => expect(events.filter((name) => name === "listed")).toHaveLength(2));
		expect(state().chats[chat.id]).toBeDefined();
	});

	it("asks before tools tool-approval wants asked about, and stamps an unscoped chat", async () => {
		const { conversations, chats } = await boot({
			plugins: [shapingPlugin({ approve: () => ({ ask: "Check first." }) })],
		});

		await conversations.methods.create({ directory: "/tmp" });

		const params = chats.writes[0]?.args[1] as CreateChatParams;
		expect(params.metadata?.["kilo-desktop"]).toEqual({});
		const asked = params.permissions?.filter(
			(rule) => rule.effect === "ask" && rule.action !== "shell",
		);
		expect(asked).toHaveLength(3);
	});

	it("gives a chat created without a directory its own folder", async () => {
		const { conversations, chats } = await boot();

		await conversations.methods.create({});

		const directory = chats.writes[0]?.args[0] as string;
		expect(path.basename(path.dirname(directory))).toBe("chats");
		expect(path.basename(directory)).toMatch(/^session-/);
	});

	it("creates chats without rules when nothing asks for any", async () => {
		const { conversations, chats } = await boot();

		await conversations.methods.create({ directory: "/tmp" });

		expect(chats.writes[0]?.args[1]).not.toHaveProperty("permissions");
	});

	it("gathers chat config for the chat's prompts", async () => {
		const { conversations } = await boot({ plugins: [shapingPlugin({})] });

		await expect(
			conversations.methods.chatConfig({
				chatId: "ses_a",
				directory: "/a",
				workSessionId: "wses_1",
				workspaceId: null,
			}),
		).resolves.toEqual({
			instructions: ["Chat ses_a of wses_1/null in /a"],
			disableTools: ["desktop_notebook_open"],
			permissions: [{ action: "shell", resource: "*conda install*", effect: "ask" }],
		});
	});

	it("reads a chat's permission requests", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const request = (id: string, chatId: string) => ({
			id,
			chatId,
			action: "shell",
			resources: ["ls"],
			metadata: { interactive: true },
		});
		chats.permissions.ses_a = [request("per_1", "ses_a"), request("per_2", "ses_other")];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(conversations.methods.permissionRequests({ id: "ses_a" })).resolves.toEqual([
			request("per_1", "ses_a"),
		]);
	});

	it("names the app's tool a permission request is for", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		chats.permissions.ses_a = [
			{
				id: "per_1",
				chatId: "ses_a",
				action: "desktop_acme_tools_deploy",
				resources: ["*"],
				metadata: {},
			},
			{ id: "per_2", chatId: "ses_a", action: "shell", resources: ["ls"], metadata: {} },
		];
		const { conversations, whenReady } = await boot({ chats, plugins: [shapingPlugin({})] });
		await whenReady();

		const requests = await conversations.methods.permissionRequests({ id: "ses_a" });

		expect(requests.map((request) => request.toolKey)).toEqual(["acme.tools/deploy", undefined]);
	});

	it("says why the server couldn't create it", async () => {
		const chats = new FakeKiloChats();
		chats.failWrites = true;
		const { conversations } = await boot({ chats });

		await expect(conversations.methods.create({ directory: "/tmp" })).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Could not create the chat: offline",
		});
	});
});

describe("acting on chats", () => {
	it("renames, stops, archives, answers and deletes chats by id", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();
		events.length = 0;

		await conversations.methods.rename({ id: "ses_a", title: "Renamed" });
		await conversations.methods.abort({ id: "ses_a" });
		await conversations.methods.setArchived({ id: "ses_a", archived: true });
		await conversations.methods.setArchived({ id: "ses_a", archived: false });
		await conversations.methods.replyPermission({
			chatId: "ses_a",
			permissionId: "per_1",
			decision: "always",
		});
		await conversations.methods.replyQuestion({
			chatId: "ses_a",
			questionId: "frm_1",
			answers: [["Yes"]],
		});
		await conversations.methods.rejectQuestion({ chatId: "ses_a", questionId: "frm_2" });
		await conversations.methods.delete({ id: "ses_a" });

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["update", ["ses_a", { title: "Renamed" }]],
			["interrupt", ["ses_a"]],
			["update", ["ses_a", { archived: true }]],
			["update", ["ses_a", { archived: false }]],
			["replyPermission", ["ses_a", "per_1", "always", undefined]],
			["replyQuestion", ["ses_a", "frm_1", [["Yes"]]]],
			["rejectQuestion", ["ses_a", "frm_2"]],
			["delete", ["ses_a"]],
		]);
		expect(state().chats.ses_a).toBeUndefined();
		expect(events).toEqual(["deleted ses_a"]);
	});

	it("answers the agent's prompts only for kilo.chat", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { kernel, whenReady } = await boot({
			chats,
			plugins: [
				testPlugin("kilo.chat", { entry: { activate: () => {} } }),
				testPlugin("acme.snoop", { entry: { activate: () => {} } }),
			],
		});
		await whenReady();
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domainObjects.get(Chats)!;
		const denied = { code: "PERMISSION_DENIED" };
		const snoop = as("acme.snoop").methods;

		await expect(
			snoop.replyPermission({ chatId: "ses_a", permissionId: "per_1", decision: "always" }),
		).rejects.toMatchObject(denied);
		await expect(
			snoop.replyQuestion({ chatId: "ses_a", questionId: "frm_1", answers: [["Yes"]] }),
		).rejects.toMatchObject(denied);
		await expect(
			snoop.rejectQuestion({ chatId: "ses_a", questionId: "frm_1" }),
		).rejects.toMatchObject(denied);
		await as("kilo.chat").methods.replyPermission({
			chatId: "ses_a",
			permissionId: "per_1",
			decision: "once",
		});

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["replyPermission", ["ses_a", "per_1", "once", undefined]],
		]);
	});

	it("sends kilo.chat's prompts and slash commands in v2's shape", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { kernel, whenReady } = await boot({
			chats,
			plugins: [
				testPlugin("kilo.chat", { entry: { activate: () => {} } }),
				testPlugin("acme.snoop", { entry: { activate: () => {} } }),
			],
		});
		await whenReady();
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domainObjects.get(Chats)!;
		const parts = [
			{ type: "text" as const, text: "Fix the login" },
			{
				type: "file" as const,
				mime: "image/png",
				url: "data:image/png;base64,AAAA",
				filename: "a.png",
			},
			{ type: "text" as const, text: "and the logout" },
			{ type: "file" as const, mime: "text/plain", url: "file:///projects/a/notes.txt" },
		];

		await expect(as("acme.snoop").methods.prompt({ chatId: "ses_a", parts })).rejects.toMatchObject(
			{ code: "PERMISSION_DENIED" },
		);
		await as("kilo.chat").methods.prompt({
			chatId: "ses_a",
			parts,
			agent: "code",
			model: { aiProviderId: "acme", modelId: "fast-1", variant: "high" },
			system: "Primary folder: /projects/a",
		});
		await as("kilo.chat").methods.prompt({
			chatId: "ses_a",
			parts: [],
			command: { name: "review", arguments: "the diff" },
			agent: "code",
			model: { aiProviderId: "acme", modelId: "fast-1" },
		});

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			[
				"prompt",
				[
					"ses_a",
					{
						text: "Fix the login\n\nand the logout",
						files: [
							{ uri: "data:image/png;base64,AAAA", name: "a.png" },
							{ uri: "file:///projects/a/notes.txt" },
						],
						agent: "code",
						model: { providerID: "acme", id: "fast-1", variant: "high" },
						metadata: { "kilo-desktop": { system: "Primary folder: /projects/a" } },
					},
				],
			],
			[
				"command",
				[
					"ses_a",
					{
						name: "review",
						text: "the diff",
						agent: "code",
						model: { providerID: "acme", id: "fast-1" },
					},
				],
			],
		]);
	});

	it("says why the server refused a prompt", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { kernel, whenReady } = await boot({
			chats,
			plugins: [testPlugin("kilo.chat", { entry: { activate: () => {} } })],
		});
		await whenReady();
		chats.failWrites = true;

		await expect(
			kernel
				.sdkFor("kilo.chat")
				.domainObjects.get(Chats)!
				.methods.prompt({
					chatId: "ses_a",
					parts: [{ type: "text", text: "Hi" }],
				}),
		).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Could not send the prompt: offline" });
	});
});

describe("one structured answer", () => {
	const request = {
		directory: "/projects/app",
		title: "Generate PR",
		system: "Write a PR title.",
		prompt: "Patch: …",
		schema: {
			type: "object",
			required: ["title"],
			properties: { title: { type: "string", maxLength: 20 } },
		},
	};

	it("asks one stateless reply with the schema in the prompt, creating no chat", async () => {
		const chats = new FakeKiloChats();
		chats.replies = ['Here you go:\n```json\n{"title":"Fix it"}\n```'];
		const { generation, whenReady, state } = await boot({ chats });
		await whenReady();

		const answer = await generation.methods.generate({
			...request,
			model: { aiProviderId: "kilo", modelId: "fast", variant: "low" },
		});

		expect(answer).toEqual({ title: "Fix it" });
		expect(chats.writes).toHaveLength(1);
		const [prompt, model] = chats.writes[0]!.args as [string, unknown];
		expect(chats.writes[0]?.call).toBe("generateText");
		expect(prompt).toContain("Write a PR title.\n\nPatch: …");
		expect(prompt).toContain(JSON.stringify(request.schema));
		expect(model).toEqual({ providerID: "kilo", id: "fast", variant: "low" });
		expect(state().chats).toEqual({});
	});

	it("asks once more when the reply doesn't match the schema", async () => {
		const chats = new FakeKiloChats();
		chats.replies = ['{"title":"Far too long for the schema"}', '{"title":"Fix it"}'];
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		await expect(generation.methods.generate(request)).resolves.toEqual({ title: "Fix it" });
		expect(chats.writes.filter(({ call }) => call === "generateText")).toHaveLength(2);
		expect(chats.writes[0]?.args[1]).toBeUndefined();
	});

	it("gives up after a second answer that isn't one", async () => {
		const chats = new FakeKiloChats();
		chats.replies = ["just text"];
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		await expect(generation.methods.generate(request)).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The model did not return a structured answer.",
		});
		expect(chats.writes).toHaveLength(2);
		chats.failing.add("generateText");
		await expect(generation.methods.generate(request)).rejects.toThrow(
			"Could not get an answer: offline",
		);
	});

	it("writes commit messages with Kilo's generator", async () => {
		const chats = new FakeKiloChats();
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			generation.methods.generateCommitMessage({ directory: "/projects/app" }),
		).resolves.toEqual({ message: "Fix login" });
		expect(chats.writes).toEqual([{ call: "generateCommitMessage", args: ["/projects/app"] }]);

		chats.commitMessage = Object.assign(new Error("nothing staged"), { type: "no_changes" });
		await expect(
			generation.methods.generateCommitMessage({ directory: "/projects/app" }),
		).rejects.toMatchObject({ code: "BUSINESS", message: "There are no changes to describe." });
		chats.commitMessage = new Error("offline");
		await expect(
			generation.methods.generateCommitMessage({ directory: "/projects/app" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});
});

describe("worktree branch naming", () => {
	it("asks the server for a branch name in the chat's directory", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			generation.methods.generateBranchName({
				chatId: "ses_a",
				prompt: "fix the login bug",
				model: { aiProviderId: "kilo", modelId: "fast" },
			}),
		).resolves.toEqual({ branch: "fix-login" });
		chats.branchName = null;
		await expect(
			generation.methods.generateBranchName({ chatId: "ses_a", prompt: "" }),
		).resolves.toEqual({ branch: null });

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			[
				"generateBranchName",
				[
					"/projects/a",
					"ses_a",
					{ prompt: "fix the login bug", providerID: "kilo", modelID: "fast" },
				],
			],
			["generateBranchName", ["/projects/a", "ses_a", { prompt: "" }]],
		]);
	});

	it("rewrites the stamp's worktree branch, keeping the rest of the metadata", async () => {
		const chats = new FakeKiloChats();
		const metadata = {
			other: "x",
			"kilo-desktop": { workspaceId: "w1", worktree: { branch: "kilo/aback-aardvark" } },
		};
		chats.chats = [desktopChat("ses_a", { metadata })];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		await conversations.methods.setWorktreeBranch({ id: "ses_a", branch: "kilo/fix-login" });

		expect(chats.writes).toEqual([
			{
				call: "update",
				args: [
					"ses_a",
					{
						metadata: {
							other: "x",
							"kilo-desktop": { workspaceId: "w1", worktree: { branch: "kilo/fix-login" } },
						},
					},
				],
			},
		]);
		expect(state().chats.ses_a?.worktreeBranch).toBe("kilo/fix-login");
		await expect(
			conversations.methods.setWorktreeBranch({ id: "ses_gone", branch: "kilo/x" }),
		).rejects.toThrow("The chat was not found.");
	});

	it("carries origin's pre-rename stamp over", () => {
		expect(withWorktreeBranch({ anaconda: { workspaceId: "w1" } }, "kilo/x")).toEqual({
			anaconda: { workspaceId: "w1" },
			"kilo-desktop": { workspaceId: "w1", worktree: { branch: "kilo/x" } },
		});
		expect(withWorktreeBranch(null, "kilo/x")).toEqual({
			"kilo-desktop": { worktree: { branch: "kilo/x" } },
		});
	});

	it("announces each message someone sends once, with its text and model", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();
		const sent: unknown[] = [];
		conversations.on("user-message", (message) => sent.push(message));
		const enqueued = (inboxID: string, sessionID: string, item: object) =>
			event("session.inbox.enqueued", { sessionID, inboxID, item });
		const user = (text: string, selection?: object) => ({
			type: "user",
			payload: { text, ...(selection ? { selection } : {}) },
			delivery: "queue",
		});

		chats.push(
			event("session.model.selected", {
				sessionID: "ses_a",
				model: { providerID: "kilo", id: "fast" },
			}),
		);
		chats.push(enqueued("msg_0", "ses_a", { type: "synthetic", payload: { text: "context" } }));
		chats.push(enqueued("msg_1", "ses_a", user("fix the login bug")));
		chats.push(enqueued("msg_1", "ses_a", user("fix the login bug")));
		chats.push(enqueued("msg_2", "ses_a", user("  ")));
		chats.push(enqueued("msg_3", "ses_cli", user("elsewhere")));
		chats.push(
			enqueued(
				"msg_4",
				"ses_a",
				user("and the logout", { model: { providerID: "acme", id: "big" } }),
			),
		);

		await eventually(() => expect(sent).toHaveLength(2));
		expect(sent).toEqual([
			{
				chatId: "ses_a",
				messageId: "msg_1",
				text: "fix the login bug",
				model: { aiProviderId: "kilo", modelId: "fast" },
			},
			{
				chatId: "ses_a",
				messageId: "msg_4",
				text: "and the logout",
				model: { aiProviderId: "acme", modelId: "big" },
			},
		]);
	});
});

describe("forking chats", () => {
	const stamped = (id: string) =>
		desktopChat(id, {
			metadata: { "kilo-desktop": { workspaceId: "w1", workSessionId: "wses_1" } },
		});

	it("forks at a message into a new chat with the same stamp, which joins the list", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();
		events.length = 0;

		const fork = await conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["fork", ["ses_a", "msg_2"]],
			["handoff", ["ses_fork_1", "/projects/app"]],
		]);
		expect(fork).toMatchObject({
			id: "ses_fork_1",
			title: "Chat ses_a (fork #1)",
			parentId: null,
			directory: "/projects/app",
			workSessionId: "wses_1",
			workspaceId: "w1",
		});
		expect(state().chats[fork.id]).toEqual(fork);
		await eventually(() => expect(events).toEqual([`created ${fork.id}`]));
		// The fork call publishes its own fork; `session.forked` looks nothing up.
		expect(chats.reads).not.toContain(`get ${fork.id}`);
	});

	it("hands the fork its hidden note before publishing it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		const release = chats.hold("handoff");

		const forking = conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await eventually(() => expect(chats.writes.map(({ call }) => call)).toContain("handoff"));
		expect(Object.keys(state().chats)).toEqual(["ses_a"]);
		release();

		const fork = await forking;
		expect(state().chats[fork.id]).toEqual(fork);
	});

	it("still lists a fork whose hidden note couldn't be sent", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.failing.add("handoff");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		const fork = await conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });

		expect(state().chats[fork.id]).toEqual(fork);
	});

	it("lists another client's fork of this app's chat", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a"), stamped("ses_cli_fork")];
		chats.chats.pop();
		const { state, whenReady } = await boot({ chats });
		await whenReady();
		chats.chats.push(stamped("ses_cli_fork"));

		chats.push(event("session.forked", { sessionID: "ses_cli_fork", parentID: "ses_a" }));

		await eventually(() => expect(state().chats.ses_cli_fork).toBeDefined());
	});

	it("refuses an unknown chat without asking the server", async () => {
		const chats = new FakeKiloChats();
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_unknown", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(chats.writes).toEqual([]);
	});

	it("refuses a subagent's chat", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		chats.push(createdEvent(desktopChat("ses_child", { parentId: "ses_a" })));
		await eventually(() => expect(state().chats.ses_child).toBeDefined());

		await expect(
			conversations.methods.fork({ id: "ses_child", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(chats.writes).toEqual([]);
	});

	it("says why the server couldn't fork it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.failing.add("fork");
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Could not fork the chat: offline" });
	});
});
