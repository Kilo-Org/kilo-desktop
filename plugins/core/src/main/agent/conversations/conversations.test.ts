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
import { desktopChat, FakeKiloChats, rawChat } from "../../../test/agent/fake-kilo-chats";
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

const status = (sessionID: string, type: string) => ({
	type: "session.status",
	properties: { sessionID, status: { type } },
});

describe("chat work completion", () => {
	it.each(["ses_child", "ses_a"])(
		"completes after stopping %s without another root turn",
		async (stopped) => {
			const chats = new FakeKiloChats();
			chats.chats = [desktopChat("ses_a"), desktopChat("ses_child", { parentId: "ses_a" })];
			const { conversations, whenReady, state } = await boot({ chats });
			await whenReady();
			const completed: string[] = [];
			conversations.on("work-completed", ({ chatId }) => completed.push(chatId));

			chats.push(status("ses_a", "busy"));
			chats.push(status("ses_child", "busy"));
			chats.push(status("ses_a", "idle"));
			await eventually(() => expect(chats.drainRequests).toHaveLength(1));
			const request = chats.drainRequests[0]!;
			expect(request).toMatchObject({ directory: "/projects/app", id: "ses_a" });
			request.resolve();
			await conversations.methods.abort({ id: stopped });
			chats.push({ type: "session.drain.interrupted", properties: { sessionID: stopped } });
			chats.push({
				type: "session.error",
				properties: { sessionID: stopped, error: { name: "MessageAbortedError" } },
			});
			chats.push(status("ses_child", "idle"));
			await eventually(() => expect(state().chats.ses_child?.activity.status).toBe("idle"));
			expect(completed).toEqual([]);

			chats.push({
				type: "session.drained",
				properties: { sessionID: "ses_a", token: request.token },
			});
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
		chats.push(status("ses_a", "busy"));
		chats.push(status("ses_a", "idle"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(1));
		const first = chats.drainRequests[0]!;
		first.resolve();
		for (let report = 0; report < 2; report++) {
			chats.push(status("ses_a", "busy"));
			chats.push(status("ses_a", "idle"));
		}
		const ack = { type: "session.drained", properties: { sessionID: "ses_a", token: first.token } };
		chats.push(ack);
		chats.push(ack);
		chats.push({
			type: "session.updated",
			properties: { info: rawChat(desktopChat("ses_a", { title: "Finished" })) },
		});
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Finished"));
		expect(events.filter((event) => event === "turn-ended ses_a")).toHaveLength(3);
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
		chats.push(status("ses_a", "busy"));
		chats.push(status("ses_a", "idle"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(1));
		const first = chats.drainRequests[0]!;
		chats.push(status("ses_a", "busy"));
		chats.push({ type: "session.drained", properties: { sessionID: "ses_a", token: first.token } });
		chats.push({
			type: "session.updated",
			properties: { info: rawChat(desktopChat("ses_a", { title: "Still working" })) },
		});
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Still working"));
		expect(completed).toEqual([]);
		expect(first.signal.aborted).toBe(true);
		chats.push(status("ses_a", "idle"));
		await eventually(() => expect(chats.drainRequests).toHaveLength(2));
		chats.push({
			type: "session.drained",
			properties: { sessionID: "ses_a", token: chats.drainRequests[1]!.token },
		});
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
			chats.push(status("ses_a", "busy"));
			chats.push(status("ses_a", "idle"));
			await eventually(() => expect(chats.drainRequests).toHaveLength(1));
			const request = chats.drainRequests[0]!;
			if (cause === "turn error" || cause === "late error") {
				if (cause === "turn error") chats.push(status("ses_a", "busy"));
				chats.push({
					type: "session.error",
					properties: {
						sessionID: "ses_a",
						error: { name: "APIError", data: { message: "Failed" } },
					},
				});
				chats.push(status("ses_a", "idle"));
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
			chats.push({
				type: "session.drained",
				properties: { sessionID: "ses_a", token: request.token },
			});
			if (cause === "server stop") {
				await kernel.kernelSdk.domainObjects
					.get(KernelServices)!
					.methods.restart({ key: SERVER_SERVICE_KEY });
				await whenReady();
			}
			if (cause !== "disposal") {
				chats.push({
					type: "session.updated",
					properties: { info: rawChat(desktopChat("ses_marker", { title: "Observed" })) },
				});
				await eventually(() => expect(state().chats.ses_marker?.title).toBe("Observed"));
			}
			expect(completed).toEqual([]);
			expect(chats.drainRequests).toHaveLength(1);
		},
	);

	it("rearms only pending live work after reconnect hydration and ignores the old token", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_startup")];
		chats.statusMap = { ses_startup: { type: "busy" } };
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		const completed: string[] = [];
		conversations.on("work-completed", ({ chatId }) => completed.push(chatId));
		expect(chats.drainRequests).toEqual([]);
		chats.push(status("ses_a", "busy"));
		chats.push(status("ses_a", "idle"));
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
		chats.push({ type: "session.drained", properties: { sessionID: "ses_a", token: first.token } });
		releaseHydration();
		await eventually(() => expect(chats.drainRequests).toHaveLength(2));
		const second = chats.drainRequests[1]!;
		expect(second.id).toBe("ses_a");
		expect(second.token).not.toBe(first.token);
		second.resolve();
		first.reject(new Error("old transport failed"));
		chats.push({ type: "session.drained", properties: { sessionID: "ses_a", token: first.token } });
		chats.push({
			type: "session.updated",
			properties: { info: rawChat(desktopChat("ses_a", { title: "Reconnected" })) },
		});
		await eventually(() => expect(state().chats.ses_a?.title).toBe("Reconnected"));
		expect(completed).toEqual([]);
		expect(second.signal.aborted).toBe(false);
		chats.push({
			type: "session.drained",
			properties: { sessionID: "ses_a", token: second.token },
		});
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
		expect(events).toEqual([]);
	});

	it("reads what is running and waiting when it connects", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_b")];
		chats.statusMap = { ses_a: { type: "busy" } };
		chats.permissions = [{ id: "per_1", sessionID: "ses_b" }];
		chats.questions = [{ id: "que_1", sessionID: "ses_b" }];

		const { state, whenReady } = await boot({ chats });
		await whenReady();

		expect(state().chats.ses_a?.activity).toMatchObject({ status: "busy" });
		expect(state().chats.ses_b?.activity).toMatchObject({
			pendingPermissionIds: ["per_1"],
			pendingQuestionIds: ["que_1"],
		});
	});

	it("announces live changes, turns and prompts", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();

		chats.push({ type: "session.created", properties: { info: rawChat(desktopChat("ses_b")) } });
		chats.push({
			type: "session.updated",
			properties: { info: rawChat(desktopChat("ses_a", { title: "Renamed", updatedAt: 300 })) },
		});
		chats.push(status("ses_a", "busy"));
		chats.push({ type: "permission.asked", properties: { id: "per_1", sessionID: "ses_a" } });
		chats.push({
			type: "permission.replied",
			properties: { requestID: "per_1", sessionID: "ses_a" },
		});
		chats.push({ type: "question.asked", properties: { id: "que_1", sessionID: "ses_a" } });
		chats.push({
			type: "question.rejected",
			properties: { requestID: "que_1", sessionID: "ses_a" },
		});
		chats.push({
			type: "session.error",
			properties: { sessionID: "ses_a", error: { name: "APIError", data: { message: "Down" } } },
		});
		chats.push(status("ses_a", "idle"));
		chats.push({ type: "session.deleted", properties: { info: rawChat(desktopChat("ses_b")) } });

		await eventually(() => expect(events).toContain("deleted ses_b"));
		expect(state().chats.ses_b).toBeUndefined();
		expect(events.filter((event) => !event.startsWith("updated"))).toEqual([
			"created ses_b",
			"turn-started ses_a",
			"permission-requested ses_a per_1",
			"permission-resolved ses_a per_1",
			"question-requested ses_a que_1",
			"question-resolved ses_a que_1",
			"turn-ended ses_a Down",
			"deleted ses_b",
		]);
		expect(state().chats.ses_a).toMatchObject({
			title: "Renamed",
			activity: { status: "idle", lastError: { name: "APIError", message: "Down" } },
		});
	});

	it("reopens a dropped stream and reads everything again, announcing what changed", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady, events } = await boot({ chats });
		await whenReady();
		chats.push(status("ses_a", "busy"));
		chats.push({
			type: "session.status",
			properties: { sessionID: "ses_far", status: { type: "busy" } },
			directory: "/projects/other",
		});
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		const listed = chats.listCalls;

		chats.chats.push(desktopChat("ses_new"));
		chats.statusMap = {};
		chats.byDirectory["/projects/other"] = {
			permissions: [{ id: "per_far", sessionID: "ses_far" }],
		};
		chats.end();

		await eventually(() => expect(chats.listCalls).toBe(listed + 1));
		await eventually(() => expect(state().chats.ses_new).toBeDefined());
		expect(chats.subscriptions).toBe(2);
		expect(state().ready).toBe(true);
		expect(state().chats.ses_a?.activity.status).toBe("idle");
		expect(chats.reads).toContain("permissions /projects/other");
		expect(chats.reads).toContain("get ses_far");
		expect(events).toContain("created ses_new");
		expect(events.filter((event) => event.startsWith("turn-ended"))).toEqual([]);
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

	it("settles activity while the server is down, and reads again when it is back", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { kernel, state, whenReady, server } = await boot({ chats });
		await whenReady();
		chats.push(status("ses_a", "busy"));
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
		chats.chats.push(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} }));

		chats.push({ type: "permission.asked", properties: { id: "per_1", sessionID: "ses_sub" } });

		await eventually(() => expect(state().chats.ses_sub).toBeDefined());
		expect(state().chats.ses_sub).toMatchObject({
			parentId: "ses_a",
			workspaceId: "w1",
			activity: { pendingPermissionIds: ["per_1"] },
		});
		expect(events).toEqual(["created ses_sub", "permission-requested ses_sub per_1"]);
	});

	it("looks a subagent up again after the stream reopens, not waiting on the dropped stream's lookup", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { state, whenReady } = await boot({ chats });
		await whenReady();
		chats.chats.push(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} }));
		chats.permissions = [{ id: "per_1", sessionID: "ses_sub" }];
		// The server lists root chats only; a subagent's is looked up.
		const listChats = chats.listChats.bind(chats);
		chats.listChats = async () => (await listChats()).filter((chat) => chat.parentId === null);
		const getChat = chats.getChat.bind(chats);
		let lookups = 0;
		chats.getChat = (id) => {
			lookups += 1;
			// The dropped stream's lookup never answers.
			return lookups === 1 ? new Promise(() => {}) : getChat(id);
		};

		chats.push({ type: "permission.asked", properties: { id: "per_1", sessionID: "ses_sub" } });
		await eventually(() => expect(lookups).toBe(1));
		chats.end();

		await eventually(() => expect(state().chats.ses_sub).toMatchObject({ parentId: "ses_a" }));
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
						permissions: [{ permission: "bash", pattern: "*conda install*", action: "ask" }],
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
		expect(created?.directory).toBe("/projects/app");
		expect(created?.args[0]).toEqual({
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
			permission: [
				{ permission: "external_directory", pattern: "/projects/lib", action: "allow" },
				{ permission: "external_directory", pattern: "/projects/lib/*", action: "allow" },
				{ permission: "bash", pattern: "*conda install*", action: "ask" },
				{ permission: "desktop_acme_tools_deploy", pattern: "*", action: "ask" },
				{ permission: "desktop_notebook_open", pattern: "*", action: "deny" },
				{ permission: "desktop_acme_tools_wipe", pattern: "*", action: "deny" },
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

	it("asks before tools tool-approval wants asked about, and stamps an unscoped chat", async () => {
		const { conversations, chats } = await boot({
			plugins: [shapingPlugin({ approve: () => ({ ask: "Check first." }) })],
		});

		await conversations.methods.create({ directory: "/tmp" });

		const params = chats.writes[0]?.args[0] as CreateChatParams;
		expect(params.metadata?.["kilo-desktop"]).toEqual({});
		const asked = params.permission?.filter(
			(rule) => rule.action === "ask" && rule.permission !== "bash",
		);
		expect(asked).toHaveLength(3);
	});

	it("gives a chat created without a directory its own folder", async () => {
		const { conversations, chats } = await boot();

		await conversations.methods.create({});

		const directory = chats.writes[0]?.directory;
		expect(path.basename(path.dirname(directory ?? ""))).toBe("chats");
		expect(path.basename(directory ?? "")).toMatch(/^session-/);
	});

	it("creates chats without rules when nothing asks for any", async () => {
		const { conversations, chats } = await boot();

		await conversations.methods.create({ directory: "/tmp" });

		expect(chats.writes[0]?.args[0]).not.toHaveProperty("permission");
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
			permissions: [{ permission: "bash", pattern: "*conda install*", action: "ask" }],
		});
	});

	it("reads a chat's permission requests from its directory", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const request = (id: string, chatId: string) => ({
			id,
			chatId,
			permission: "bash",
			patterns: ["ls"],
			metadata: { skillShell: true },
		});
		chats.permissionRequestsByDirectory["/projects/a"] = [
			request("per_1", "ses_a"),
			request("per_2", "ses_other"),
		];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(conversations.methods.permissionRequests({ id: "ses_a" })).resolves.toEqual([
			request("per_1", "ses_a"),
		]);
	});

	it("names the app's tool a permission request is for", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		chats.permissionRequestsByDirectory["/projects/a"] = [
			{
				id: "per_1",
				chatId: "ses_a",
				permission: "desktop_acme_tools_deploy",
				patterns: ["*"],
				metadata: {},
			},
			{ id: "per_2", chatId: "ses_a", permission: "bash", patterns: ["ls"], metadata: {} },
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
	it("writes to each chat's own directory", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await conversations.methods.rename({ id: "ses_a", title: "Renamed" });
		await conversations.methods.abort({ id: "ses_a" });
		await conversations.methods.setArchived({ id: "ses_a", archived: false });
		await conversations.methods.replyPermission({
			chatId: "ses_a",
			permissionId: "per_1",
			reply: "always",
			interactive: true,
		});
		await conversations.methods.replyQuestion({
			chatId: "ses_a",
			questionId: "que_1",
			answers: [["Yes"]],
		});
		await conversations.methods.rejectQuestion({ chatId: "ses_a", questionId: "que_2" });
		await conversations.methods.delete({ id: "ses_a" });
		await conversations.methods.delete({ id: "ses_unknown" });

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args])).toEqual([
			["update", "/projects/a", ["ses_a", { title: "Renamed" }]],
			["abort", "/projects/a", ["ses_a"]],
			["update", "/projects/a", ["ses_a", { archived: null }]],
			["replyPermission", "/projects/a", ["per_1", "always", undefined, true]],
			["replyQuestion", "/projects/a", ["que_1", [["Yes"]]]],
			["rejectQuestion", "/projects/a", ["que_2"]],
			["delete", "/projects/a", ["ses_a"]],
			["delete", "/home", ["ses_unknown"]],
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
			snoop.replyPermission({ chatId: "ses_a", permissionId: "per_1", reply: "always" }),
		).rejects.toMatchObject(denied);
		await expect(
			snoop.replyQuestion({ chatId: "ses_a", questionId: "que_1", answers: [["Yes"]] }),
		).rejects.toMatchObject(denied);
		await expect(
			snoop.rejectQuestion({ chatId: "ses_a", questionId: "que_1" }),
		).rejects.toMatchObject(denied);
		await as("kilo.chat").methods.replyPermission({
			chatId: "ses_a",
			permissionId: "per_1",
			reply: "once",
		});

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["replyPermission", ["per_1", "once", undefined, undefined]],
		]);
	});

	it("sends kilo.chat's prompts and slash commands to the chat's directory, in the server's shape", async () => {
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

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args])).toEqual([
			[
				"prompt",
				"/projects/a",
				[
					"ses_a",
					{
						parts,
						agent: "code",
						model: { providerID: "acme", modelID: "fast-1" },
						variant: "high",
						system: "Primary folder: /projects/a",
					},
				],
			],
			[
				"command",
				"/projects/a",
				[
					"ses_a",
					{
						command: "review",
						arguments: "the diff",
						agent: "code",
						model: { providerID: "acme", modelID: "fast-1" },
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

	it("archives with the time it happened", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await conversations.methods.setArchived({ id: "ses_a", archived: true });

		expect(chats.writes[0]?.args[1]).toEqual({ archived: expect.any(Number) });
	});
});

describe("one structured answer", () => {
	const request = {
		directory: "/projects/app",
		title: "Generate commit message",
		system: "Write a commit subject.",
		prompt: "Patch: …",
		schema: { type: "object", properties: { message: { type: "string" } } },
	};

	it("asks a throwaway chat that may only answer, then deletes it without listing it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { generation, whenReady, state, events } = await boot({ chats });
		await whenReady();

		const answer = await generation.methods.generate({
			...request,
			model: { aiProviderId: "kilo", modelId: "fast", variant: "low" },
		});

		expect(answer).toEqual({ message: "Fix it" });
		const [create, prompt, remove] = chats.writes;
		expect(create).toMatchObject({ call: "create", directory: "/projects/app" });
		const params = create?.args[0] as CreateChatParams;
		expect(params.metadata).toBeUndefined();
		expect(params.title).toBe("Generate commit message");
		expect(params.permission).toEqual([
			{ permission: "*", pattern: "*", action: "deny" },
			{ permission: "StructuredOutput", pattern: "*", action: "allow" },
		]);
		expect(prompt).toEqual({
			call: "promptStructured",
			directory: "/projects/app",
			args: [
				"ses_new_1",
				{
					system: request.system,
					text: request.prompt,
					schema: request.schema,
					model: { providerID: "kilo", modelID: "fast", variant: "low" },
				},
			],
		});
		expect(remove).toEqual({ call: "delete", directory: "/projects/app", args: ["ses_new_1"] });

		// A late announcement of the throwaway chat, already deleted.
		const throwaway = desktopChat("ses_new_1", {
			title: "Generate commit message",
			metadata: null,
		});
		chats.push({ type: "session.created", properties: { info: rawChat(throwaway) } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(Object.keys(state().chats)).toEqual(["ses_a"]);
		expect(events).toEqual([]);
	});

	it("uses the server's model when none is given", async () => {
		const chats = new FakeKiloChats();
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		await generation.methods.generate(request);

		expect(chats.writes[1]?.args[1]).not.toHaveProperty("model");
	});

	it("deletes the chat when the answer is missing or the prompt fails", async () => {
		const chats = new FakeKiloChats();
		const { generation, whenReady } = await boot({ chats });
		await whenReady();

		chats.structuredAnswer = "just text";
		await expect(generation.methods.generate(request)).rejects.toThrow(
			"The model did not return a structured answer.",
		);
		chats.failPrompt = true;
		await expect(generation.methods.generate(request)).rejects.toThrow(
			"Could not get an answer: model unavailable",
		);

		expect(chats.writes.filter(({ call }) => call === "delete")).toHaveLength(2);
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

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args])).toEqual([
			[
				"generateBranchName",
				"/projects/a",
				["ses_a", { prompt: "fix the login bug", providerID: "kilo", modelID: "fast" }],
			],
			["generateBranchName", "/projects/a", ["ses_a", { prompt: "" }]],
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
				directory: "/projects/app",
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
		const userMessage = (id: string, sessionID: string, role = "user") => ({
			type: "message.updated",
			properties: {
				sessionID,
				info: { id, sessionID, role, model: { providerID: "kilo", modelID: "fast" } },
			},
		});
		const textPart = (messageID: string, text: string, extra: object = {}) => ({
			type: "message.part.updated",
			properties: {
				sessionID: "ses_a",
				part: { id: `prt_${text}`, messageID, sessionID: "ses_a", type: "text", text, ...extra },
			},
		});

		chats.push(userMessage("msg_1", "ses_a"));
		chats.push(textPart("msg_1", "context", { synthetic: true }));
		chats.push(textPart("msg_1", "fix the login bug"));
		chats.push(textPart("msg_1", "again"));
		chats.push(userMessage("msg_1", "ses_a"));
		chats.push(userMessage("msg_2", "ses_a", "assistant"));
		chats.push(textPart("msg_2", "answer"));
		chats.push(userMessage("msg_3", "ses_cli"));
		chats.push(textPart("msg_3", "elsewhere"));
		chats.push(userMessage("msg_4", "ses_a"));
		chats.push(textPart("msg_4", "and the logout"));

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
				model: { aiProviderId: "kilo", modelId: "fast" },
			},
		]);
	});
});

describe("forking chats", () => {
	/** Drops the event stream and waits until kilo.core has reconnected and read the list again. */
	async function reread(chats: FakeKiloChats) {
		const listed = chats.listCalls;
		const subscribed = chats.subscriptions;
		chats.end();
		await eventually(() => {
			expect(chats.listCalls).toBeGreaterThan(listed);
			expect(chats.subscriptions).toBeGreaterThan(subscribed);
		});
		// Lets the read settle and anything it starts (the unfinished-fork retry) run.
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	const stamped = (id: string) =>
		desktopChat(id, {
			metadata: { "kilo-desktop": { workspaceId: "w1", workSessionId: "wses_1" } },
		});

	it("forks at a message into a new chat with the same stamp, which joins the list", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		const fork = await conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args])).toEqual([
			["fork", "/projects/app", ["ses_a", "msg_2"]],
			["handoff", "/projects/app", ["ses_fork_1"]],
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
	});

	it("carries the source chat's permission rules to the fork", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const rules = [
			{ permission: "external_directory", pattern: "/projects/lib", action: "allow" as const },
			{ permission: "desktop_notebook_open", pattern: "*", action: "deny" as const },
		];
		chats.permissionsById.ses_a = rules;
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		const fork = await conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args])).toEqual([
			["fork", "/projects/app", ["ses_a", "msg_2"]],
			["update", "/projects/app", [fork.id, { permission: rules }]],
			["handoff", "/projects/app", [fork.id]],
		]);
	});

	it("hands the fork its hidden note before anyone can prompt it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		const { kernel, whenReady } = await boot({
			chats,
			plugins: [testPlugin("kilo.chat", { entry: { activate: () => {} } })],
		});
		await whenReady();
		const asChat = kernel.sdkFor("kilo.chat").domainObjects.get(Chats)!;

		const fork = await asChat.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await asChat.methods.prompt({ chatId: fork.id, parts: [{ type: "text", text: "Try B" }] });

		expect(chats.writes.map(({ call, directory, args }) => [call, directory, args[0]])).toEqual([
			["fork", "/projects/app", "ses_a"],
			["handoff", "/projects/app", fork.id],
			["prompt", "/projects/app", fork.id],
		]);
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
		chats.chats = [stamped("ses_a"), desktopChat("ses_child", { parentId: "ses_a" })];
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		expect(state().chats.ses_child).toBeDefined();

		await expect(
			conversations.methods.fork({ id: "ses_child", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(chats.writes).toEqual([]);
	});

	it("forks nothing when the source's permission rules can't be read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.failing.add("getPermission");
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Could not read the chat's permissions: offline",
		});
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

	it("deletes a fork whose permission rules can't be applied, never listing it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("update");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Could not apply the chat's permissions: offline",
		});
		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["fork", ["ses_a", "msg_2"]],
			["delete", ["ses_fork_1"]],
		]);
		// The stream is in order: once this lands, so has the fork's `session.created`.
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("never lists a fork whose rules failed and whose deletion failed too, even once re-read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("update");
		chats.failing.add("delete");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await reread(chats);
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));

		expect(chats.chats.map(({ id }) => id)).toContain("ses_fork_1");
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("deletes a fork it couldn't delete before once the chat list is read again", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("update");
		chats.failing.add("delete");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		chats.failing.delete("delete");

		await reread(chats);

		await eventually(() =>
			expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
				{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
			]),
		);
		await reread(chats);
		expect(chats.writes.filter(({ call }) => call === "delete")).toHaveLength(1);
		expect(state().chats.ses_fork_1).toBeUndefined();
	});

	it("tries deleting it again on the next read when a retry fails too", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("update");
		chats.failing.add("delete");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();
		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });

		await reread(chats);
		expect(state().chats.ses_fork_1).toBeUndefined();
		chats.failing.delete("delete");
		await reread(chats);

		await eventually(() =>
			expect(chats.writes.filter(({ call }) => call === "delete")).toHaveLength(1),
		);
		expect(chats.chats.map(({ id }) => id)).toEqual(["ses_a"]);
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("deletes a fork it couldn't record as unfinished, never listing it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		const { conversations, whenReady, state, events, failingStorage } = await boot({ chats });
		await whenReady();
		failingStorage.add("unfinished-forks");

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["fork", ["ses_a", "msg_2"]],
			["delete", ["ses_fork_1"]],
		]);
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("never lists a fork it couldn't record as unfinished or delete, and deletes it on a later read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("delete");
		const { conversations, whenReady, state, events, failingStorage } = await boot({ chats });
		await whenReady();
		failingStorage.add("unfinished-forks");

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await reread(chats);
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));

		expect(chats.chats.map(({ id }) => id)).toContain("ses_fork_1");
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);

		chats.failing.delete("delete");
		await reread(chats);

		await eventually(() => expect(chats.chats.map(({ id }) => id)).toEqual(["ses_a"]));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("deletes a fork the server made though its reply was lost, never listing it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.loseForkReply = true;
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Could not fork the chat: connection reset",
		});

		expect(chats.writes.map(({ call, args }) => [call, args])).toEqual([
			["fork", ["ses_a", "msg_2"]],
			["delete", ["ses_fork_1"]],
		]);
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("keeps hiding a fork whose reply was lost when deleting it fails, until a later read deletes it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		chats.failing.add("delete");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await reread(chats);
		expect(state().chats.ses_fork_1).toBeUndefined();

		chats.failing.delete("delete");
		await reread(chats);

		await eventually(() => expect(chats.chats.map(({ id }) => id)).toEqual(["ses_a"]));
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("leaves other chats made in the work session meanwhile alone when a fork's reply was lost", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		const release = chats.hold("fork");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		const forking = conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await eventually(() => expect(chats.writes.map(({ call }) => call)).toEqual(["fork"]));
		const other = stamped("ses_other");
		chats.chats.push(other);
		chats.push({ type: "session.created", properties: { info: rawChat(other) } });
		release();
		await expect(forking).rejects.toMatchObject({ code: "UNAVAILABLE" });

		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
			{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
		]);
		await eventually(() => expect(state().chats.ses_other).toBeDefined());
	});

	it("finds a lost-reply fork among the chats it has seen when the list can't be read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();
		chats.failList = true;

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });

		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
			{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
		]);
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("keeps a lost-reply fork it hasn't seen hidden until the list can be read, then deletes it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		chats.quietForks = true;
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();
		chats.failList = true;

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		const created = chats.chats.find(({ id }) => id === "ses_fork_1")!;
		chats.push({ type: "session.created", properties: { info: rawChat(created) } });
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([]);

		chats.failList = false;

		await eventually(() =>
			expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
				{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
			]),
		);
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("deletes only the earliest chat that looks like a lost-reply fork", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		const release = chats.hold("fork");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		const forking = conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await eventually(() => expect(chats.writes.map(({ call }) => call)).toEqual(["fork"]));
		// Another client forks the same chat meanwhile: same title and stamp, made later.
		const elsewhere = {
			...stamped("ses_elsewhere"),
			title: "Chat ses_a (fork #1)",
			createdAt: 700,
		};
		chats.chats.push(elsewhere);
		chats.push({ type: "session.created", properties: { info: rawChat(elsewhere) } });
		release();
		await expect(forking).rejects.toMatchObject({ code: "UNAVAILABLE" });

		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
			{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
		]);
		await eventually(() => expect(state().chats.ses_elsewhere).toBeDefined());
	});

	it("leaves a fork made after a lost reply alone while still looking for the lost one", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.loseForkReply = true;
		chats.quietForks = true;
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();
		chats.failList = true;
		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		chats.loseForkReply = false;
		chats.quietForks = false;

		const retried = await conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		chats.failList = false;

		await eventually(() =>
			expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
				{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
			]),
		);
		await eventually(() => expect(state().chats[retried.id]).toBeDefined());
	});

	it("still finds a lost fork the server only lists after the first read", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.failing.add("fork");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		// The server commits the fork after the request failed and the first read missed it.
		const late = { ...stamped("ses_late"), title: "Chat ses_a (fork #1)" };
		chats.chats.push(late);
		chats.push({ type: "session.created", properties: { info: rawChat(late) } });

		await eventually(() =>
			expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([
				{ call: "delete", directory: "/projects/app", args: ["ses_late"] },
			]),
		);
		expect(state().chats.ses_late).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_late"))).toEqual([]);
	});

	it("stops hiding new chats once a second read still shows no lost fork", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.failing.add("fork");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		const other = stamped("ses_other");
		chats.chats.push(other);
		chats.push({ type: "session.created", properties: { info: rawChat(other) } });

		await eventually(() => expect(state().chats.ses_other).toBeDefined());
		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([]);
	});

	it("forgets an unfinished fork the server no longer lists, without deleting it", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		chats.failing.add("update");
		chats.failing.add("delete");
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();
		await expect(
			conversations.methods.fork({ id: "ses_a", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		chats.chats = chats.chats.filter(({ id }) => id !== "ses_fork_1");
		chats.failing.delete("delete");

		await reread(chats);
		chats.chats.push(stamped("ses_fork_1"));
		await reread(chats);

		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([]);
	});

	it("leaves a fork still being made to its own fork call when the list is read meanwhile", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		const release = chats.hold("update");
		const { conversations, whenReady, state } = await boot({ chats });
		await whenReady();

		const forking = conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await eventually(() =>
			expect(chats.writes.map(({ call }) => call)).toEqual(["fork", "update"]),
		);
		await reread(chats);
		release();
		const fork = await forking;

		expect(chats.writes.filter(({ call }) => call === "delete")).toEqual([]);
		expect(state().chats[fork.id]).toEqual(fork);
	});

	it("deletes a fork the app stopped making midway, after it starts again", async () => {
		const before = new FakeKiloChats();
		before.chats = [stamped("ses_a")];
		before.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		before.hold("update");
		const first = await boot({ chats: before });
		await first.whenReady();
		void first.conversations.methods
			.fork({ id: "ses_a", messageId: "msg_2" })
			.catch(() => undefined);
		await eventually(() =>
			expect(before.writes.map(({ call }) => call)).toEqual(["fork", "update"]),
		);
		await first.kernel.stop();

		const after = new FakeKiloChats();
		after.chats = [stamped("ses_a"), stamped("ses_fork_1")];
		const { whenReady, state, events } = await boot({ chats: after, root: first.root });
		await whenReady();

		await eventually(() =>
			expect(after.writes).toEqual([
				{ call: "delete", directory: "/projects/app", args: ["ses_fork_1"] },
			]),
		);
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);
	});

	it("keeps nothing to clean up after restarting when the source had no rules", async () => {
		const before = new FakeKiloChats();
		before.chats = [stamped("ses_a")];
		before.hold("handoff");
		const first = await boot({ chats: before });
		await first.whenReady();
		void first.conversations.methods
			.fork({ id: "ses_a", messageId: "msg_2" })
			.catch(() => undefined);
		await eventually(() =>
			expect(before.writes.map(({ call }) => call)).toEqual(["fork", "handoff"]),
		);
		await first.kernel.stop();

		const after = new FakeKiloChats();
		after.chats = [stamped("ses_a"), stamped("ses_fork_1")];
		const { whenReady, state } = await boot({ chats: after, root: first.root });
		await whenReady();
		await reread(after);

		expect(state().chats.ses_fork_1).toBeDefined();
		expect(after.writes).toEqual([]);
	});

	it("lists the fork only once its permission rules are applied", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [stamped("ses_a")];
		chats.permissionsById.ses_a = [{ permission: "bash", pattern: "*", action: "ask" }];
		const release = chats.hold("update");
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		const forking = conversations.methods.fork({ id: "ses_a", messageId: "msg_2" });
		await eventually(() =>
			expect(chats.writes.map(({ call }) => call)).toEqual(["fork", "update"]),
		);
		chats.push(status("ses_a", "busy"));
		await eventually(() => expect(state().chats.ses_a?.activity.status).toBe("busy"));
		expect(state().chats.ses_fork_1).toBeUndefined();
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual([]);

		release();
		const fork = await forking;

		expect(state().chats[fork.id]).toEqual(fork);
		expect(events.filter((event) => event.includes("ses_fork"))).toEqual(["created ses_fork_1"]);
	});
});
