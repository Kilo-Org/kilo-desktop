import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { KernelServices, type DecisionAnswer, type PluginRegistration } from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentTool,
	Conversations,
	SERVER_SERVICE_KEY,
	SessionConfigPoint,
	ToolApproval,
} from "../../contracts";
import { desktopChat, FakeKiloChats, rawChat } from "../../test/fake-kilo-chats";
import { FakeServer } from "../../test/fake-server";
import { createAgentMainEntry } from "../agent";
import { withWorktreeBranch } from ".";
import type { CreateChatParams } from "./kilo-chat-client";

/** Readiness spans server, stream and kernel turns, which take longer when every package's tests run at once (pre-push). */
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 5_000 });

const directories: string[] = [];
const kernels: MainKernel[] = [];

afterEach(async () => {
	for (const kernel of kernels.splice(0)) await kernel.stop();
	await Promise.all(
		directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 })),
	);
});

const termsAccepted = testPlugin("kilo.account", {
	manifest: { contextKeys: [{ id: "termsAccepted", scope: "global" }] },
	entry: { activate: (sdk) => sdk.context.set("termsAccepted", true) },
});

async function boot(
	options: {
		chats?: FakeKiloChats;
		plugins?: readonly PluginRegistration[];
		holdServer?: boolean;
	} = {},
) {
	const storage = await mkdtemp(path.join(tmpdir(), "kilo-conversations-"));
	directories.push(storage);
	const chats = options.chats ?? new FakeKiloChats();
	let server: FakeServer | undefined;
	let release = () => {};
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: AGENT_DEFINITIONS,
				entry: createAgentMainEntry({
					createServer: (input) => {
						server = new FakeServer(input);
						if (options.holdServer) {
							server.startGate = new Promise<void>((resolve) => (release = resolve));
						}
						return server;
					},
					createChatClient: () => chats,
					chatReconnectDelayMs: 5,
					userConfigDirectory: path.join(storage, "user-config"),
					kiloAuthFile: path.join(storage, "auth.json"),
					envRestartDebounceMs: 5,
				}),
			},
			termsAccepted,
			...(options.plugins ?? []),
		],
		// Nested as in the app, so the unscoped chats folder lands inside `storage`.
		hostServices: () => ({
			storage: createMemoryStorage(path.join(storage, "plugins", "kilo.agent")),
		}),
	});
	kernels.push(kernel);
	await kernel.start();
	// Not awaited: a held server keeps the window-shown services starting.
	void kernel.windowShown();
	const conversations = kernel.kernelSdk.domains.get(Conversations)!;
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
		kernel,
		conversations,
		chats,
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

describe("following the server's chats", () => {
	it("lists this app's chats and their subagents once the server is ready", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a"), desktopChat("ses_cli", { metadata: {} })];
		const { state, whenReady, release, events } = await boot({ chats, holdServer: true });
		expect(state()).toEqual({ ready: false, chats: {} });

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
		await kernel.kernelSdk.domains
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

/** A plugin with two tools, one that asks, plus approval and session config contributions. */
function shapingPlugin(options: {
	approve?: (tool: string) => DecisionAnswer;
	failConfig?: boolean;
}) {
	const tool = { description: "x", input: z.object({}), run: () => null };
	return testPlugin("acme.tools", {
		manifest: {
			contributes: {
				extensions: {
					"kilo.agent/tool": [
						{ id: "deploy", title: "Deploy", approval: "ask" },
						{ id: "list", title: "List" },
						{ id: "wipe", title: "Wipe" },
					],
					"kilo.agent/tool-approval": [{ id: "policy" }],
					"kilo.agent/session-config": [{ id: "config" }, { id: "broken" }],
				},
			},
		},
		entry: {
			activate: (sdk) => {
				for (const id of ["deploy", "list", "wipe"]) sdk.extensions.implement(AgentTool, id, tool);
				sdk.extensions.implement(ToolApproval, "policy", ({ tool: name }) =>
					options.approve ? options.approve(name) : "proceed",
				);
				sdk.extensions.implement(SessionConfigPoint, "config", {
					configure: (context) => ({
						disableTools: ["desktop_notebook_open"],
						instructions: [`Session ${context.sessionId} in ${context.directory}`],
						permissions: [{ permission: "bash", pattern: "*conda install*", action: "ask" }],
					}),
				});
				sdk.extensions.implement(SessionConfigPoint, "broken", {
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
						return tool === "desktop_acme_tools_wipe" ? { reject: "Never." } : "proceed";
					},
				}),
			],
		});
		await whenReady();

		const chat = await conversations.methods.create({
			directory: "/projects/app",
			sessionId: "wses_1",
			workspaceId: "w1",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
			worktreeBranch: "kilo/fix",
			agent: "code",
			model: { providerID: "kilo", id: "m1", variant: "high" },
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
		expect(asked.sort()).toEqual([
			"desktop_acme_tools_deploy",
			"desktop_acme_tools_list",
			"desktop_acme_tools_wipe",
		]);
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

	it("gathers session config for the chat's prompts", async () => {
		const { conversations } = await boot({ plugins: [shapingPlugin({})] });

		await expect(
			conversations.methods.sessionConfig({
				sessionId: "wses_1",
				workspaceId: null,
				directory: "/a",
			}),
		).resolves.toEqual({
			instructions: ["Session wses_1 in /a"],
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
			["replyPermission", "/projects/a", ["per_1", "always", undefined]],
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
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domains.get(Conversations)!;
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
			["replyPermission", ["per_1", "once", undefined]],
		]);
	});

	it("sends kilo.chat's prompts and slash commands to the chat's directory, waiting out a slow snapshot", async () => {
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
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domains.get(Conversations)!;
		const parts = [
			{ type: "text", text: "Fix the login" },
			{ type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "a.png" },
		];

		await expect(as("acme.snoop").methods.prompt({ chatId: "ses_a", parts })).rejects.toMatchObject(
			{ code: "PERMISSION_DENIED" },
		);
		await as("kilo.chat").methods.prompt({
			chatId: "ses_a",
			parts,
			agent: "code",
			model: { providerID: "acme", modelID: "fast-1" },
			variant: "high",
			system: "Primary folder: /projects/a",
		});
		await as("kilo.chat").methods.prompt({
			chatId: "ses_a",
			parts: [],
			command: { name: "review", arguments: "the diff" },
			agent: "code",
			model: { providerID: "acme", modelID: "fast-1" },
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
				.domains.get(Conversations)!
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
		const { conversations, whenReady, state, events } = await boot({ chats });
		await whenReady();

		const answer = await conversations.methods.generate({
			...request,
			model: { providerID: "kilo", modelID: "fast", variant: "low" },
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

		chats.push({ type: "session.created", properties: { info: rawChat(chats.chats[1]!) } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(Object.keys(state().chats)).toEqual(["ses_a"]);
		expect(events).toEqual([]);
	});

	it("uses the server's model when none is given", async () => {
		const chats = new FakeKiloChats();
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await conversations.methods.generate(request);

		expect(chats.writes[1]?.args[1]).not.toHaveProperty("model");
	});

	it("deletes the chat when the answer is missing or the prompt fails", async () => {
		const chats = new FakeKiloChats();
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		chats.structuredAnswer = "just text";
		await expect(conversations.methods.generate(request)).rejects.toThrow(
			"The model did not return a structured answer.",
		);
		chats.failPrompt = true;
		await expect(conversations.methods.generate(request)).rejects.toThrow(
			"Could not get an answer: model unavailable",
		);

		expect(chats.writes.filter(({ call }) => call === "delete")).toHaveLength(2);
	});
});

describe("worktree branch naming", () => {
	it("asks the server for a branch name in the chat's directory", async () => {
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a", { directory: "/projects/a" })];
		const { conversations, whenReady } = await boot({ chats });
		await whenReady();

		await expect(
			conversations.methods.generateBranchName({
				chatId: "ses_a",
				prompt: "fix the login bug",
				model: { providerID: "kilo", modelID: "fast" },
			}),
		).resolves.toEqual({ branch: "fix-login" });
		chats.branchName = null;
		await expect(
			conversations.methods.generateBranchName({ chatId: "ses_a", prompt: "" }),
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
				model: { providerID: "kilo", modelID: "fast" },
			},
			{
				chatId: "ses_a",
				messageId: "msg_4",
				text: "and the logout",
				model: { providerID: "kilo", modelID: "fast" },
			},
		]);
	});
});
