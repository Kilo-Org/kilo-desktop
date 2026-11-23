import { afterEach, describe, expect, it } from "vitest";

import type { KernelError } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import { Chats, Swarm } from "../../../contracts";
import { bootAgent, cleanUpAgents, eventually } from "../../../test/agent/boot";
import { desktopChat, FakeKiloChats } from "../../../test/agent/fake-kilo-chats";

afterEach(cleanUpAgents);

const message = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	timestamp: 1_000 + Number(id.replace(/\D/g, "") || 0),
	from: "ses_child",
	to: "main",
	fromLabel: "Map bridge RPC",
	toLabel: "main",
	type: "RESULT",
	body: `body ${id}`,
	...overrides,
});

async function boot(chats: FakeKiloChats) {
	const agent = await bootAgent({ chats, waitForServer: true });
	const conversations = agent.kernel.kernelSdk.domainObjects.get(Chats)!;
	await eventually(() => expect(conversations.getState().ready).toBe(true));
	return { ...agent, swarm: agent.kernel.kernelSdk.domainObjects.get(Swarm)! };
}

function rooted() {
	const chats = new FakeKiloChats();
	chats.chats = [desktopChat("ses_root", { directory: "/repo" })];
	return chats;
}

describe("kilo.core/swarm", () => {
	it("reads the board in the chat's directory, mapped to the contract", async () => {
		const chats = rooted();
		chats.boards.ses_root = {
			ownerSessionID: "ses_root",
			revision: 3,
			messages: [message("m1", { reply_to: "m0" })],
			hasMore: false,
		};
		const { swarm } = await boot(chats);

		const board = await swarm.methods.board({ chatId: "ses_root" });

		expect(board).toEqual({
			ownerChatId: "ses_root",
			revision: 3,
			messages: [
				{
					id: "m1",
					timestamp: 1_001,
					from: "ses_child",
					to: "main",
					fromLabel: "Map bridge RPC",
					toLabel: "main",
					type: "RESULT",
					body: "body m1",
					replyTo: "m0",
				},
			],
			hasMore: false,
		});
	});

	it("pages back with the cursor it returned", async () => {
		const chats = rooted();
		chats.boards.ses_root = {
			ownerSessionID: "ses_root",
			revision: 1,
			messages: ["m1", "m2", "m3"].map((id) => message(id)),
			hasMore: false,
		};
		const { swarm } = await boot(chats);

		const newest = await swarm.methods.board({ chatId: "ses_root", limit: 2 });
		expect(newest.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
		expect(newest.hasMore).toBe(true);

		const older = await swarm.methods.board({
			chatId: "ses_root",
			limit: 2,
			before: newest.cursor!,
		});
		expect(older.messages.map((m) => m.id)).toEqual(["m1"]);
		expect(older.hasMore).toBe(false);
	});

	it("drops messages of a type it doesn't know instead of failing the page", async () => {
		const chats = rooted();
		chats.boards.ses_root = {
			ownerSessionID: "ses_root",
			revision: 1,
			messages: [message("m1"), message("m2", { type: "SHOUT" })],
			hasMore: false,
		};
		const { swarm } = await boot(chats);

		const board = await swarm.methods.board({ chatId: "ses_root" });
		expect(board.messages.map((m) => m.id)).toEqual(["m1"]);
	});

	it("resets at the revision it saw, and refuses with CONFLICT when the board moved", async () => {
		const chats = rooted();
		chats.boards.ses_root = {
			ownerSessionID: "ses_root",
			revision: 4,
			messages: [message("m1")],
			hasMore: false,
		};
		const { swarm } = await boot(chats);

		await expect(swarm.methods.reset({ chatId: "ses_root", revision: 3 })).rejects.toMatchObject({
			code: "CONFLICT",
		} satisfies Partial<KernelError>);

		const cleared = await swarm.methods.reset({ chatId: "ses_root", revision: 4 });
		expect(cleared.messages).toEqual([]);
		// Kilo clears up to the revision; the revision itself stays.
		expect(cleared.revision).toBe(4);
		expect(chats.writes.filter((write) => write.call === "resetBoard")).toEqual([
			{ call: "resetBoard", directory: "/repo", args: ["ses_root", 3] },
			{ call: "resetBoard", directory: "/repo", args: ["ses_root", 4] },
		]);
	});

	it("lists background jobs with their chat and agent, and cancels one", async () => {
		const chats = rooted();
		chats.jobs.ses_root = [
			{
				id: "job_1",
				type: "task",
				title: "Map bridge RPC methods",
				status: "running",
				started_at: 10,
				metadata: {
					parentSessionId: "ses_root",
					sessionId: "ses_child",
					agent: "explore",
					model: { providerID: "kilo", modelID: "anthropic/claude-haiku-4.5" },
				},
			},
			{
				id: "job_2",
				type: "task",
				status: "error",
				started_at: 5,
				completed_at: "NaN",
				error: "boom",
			},
		];
		const { swarm } = await boot(chats);

		expect(await swarm.methods.jobs({ chatId: "ses_root" })).toEqual([
			{
				id: "job_1",
				type: "task",
				title: "Map bridge RPC methods",
				status: "running",
				chatId: "ses_child",
				agent: "explore",
				model: "kilo/anthropic/claude-haiku-4.5",
				startedAt: 10,
			},
			{ id: "job_2", type: "task", status: "error", startedAt: 5, error: "boom" },
		]);

		await swarm.methods.cancelJob({ chatId: "ses_root", jobId: "job_1" });
		expect(chats.writes.find((write) => write.call === "cancelBackgroundJob")).toEqual({
			call: "cancelBackgroundJob",
			directory: "/repo",
			args: ["job_1"],
		});
	});

	it("explains a server failure as UNAVAILABLE", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);

		await expect(swarm.methods.board({ chatId: "ses_root" })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});

describe("kilo.core/swarm board events", () => {
	it("relays Kilo's board.updated for the board's root chat", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);
		const seen: unknown[] = [];
		swarm.on("board-updated", (event) => seen.push(event));

		chats.push({
			type: "board.updated",
			properties: {
				sessionID: "ses_root",
				revision: 7,
				cleared: 3,
				reason: "post",
				messageID: "m7",
			},
		});

		await eventually(() => expect(seen).toEqual([{ chatId: "ses_root", revision: 7, cleared: 3 }]));
	});

	it("says whether the server announces board changes, read when it connects", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);
		expect(swarm.getState().boardEvents).toBe(false);

		chats.capabilityFlags = { backgroundSubagents: true, swarm: { boardEvents: true } };
		chats.push({ type: "server.connected", properties: {} });

		await eventually(() => expect(swarm.getState().boardEvents).toBe(true));
	});
});

describe("kilo.core/swarm team", () => {
	const roster = {
		enabled: true,
		truncated: false,
		members: [
			{
				sessionID: "ses_child",
				parentID: "ses_root",
				agent: "explore",
				title: "Map bridge RPC",
				directory: "/repo",
				background: true,
				state: "busy",
				live: true,
				attention: ["question", "nonsense"],
				model: { providerID: "kilo", modelID: "anthropic/claude-haiku-4.5", variant: "low" },
				timeStarted: 2,
			},
			{
				sessionID: "ses_cut",
				parentID: "ses_root",
				agent: "",
				title: "Cut off",
				directory: "/repo",
				background: false,
				state: "weird",
				live: false,
				attention: [],
				timeStarted: 1,
				timeCompleted: 5,
				error: "boom",
			},
		],
	};

	it("reads Kilo's roster once the server says it has one", async () => {
		const chats = rooted();
		chats.teams.ses_root = roster;
		chats.capabilityFlags = { swarm: { team: true } };
		const { swarm } = await boot(chats);
		chats.push({ type: "server.connected", properties: {} });
		await eventually(() => expect(swarm.getState().team).toBe(true));

		expect(await swarm.methods.team({ chatId: "ses_root" })).toEqual({
			truncated: false,
			members: [
				{
					chatId: "ses_child",
					parentChatId: "ses_root",
					agent: "explore",
					title: "Map bridge RPC",
					directory: "/repo",
					state: "busy",
					background: true,
					live: true,
					attention: ["question"],
					model: "kilo/anthropic/claude-haiku-4.5",
					variant: "low",
					startedAt: 2,
				},
				{
					chatId: "ses_cut",
					parentChatId: "ses_root",
					title: "Cut off",
					directory: "/repo",
					state: "unknown",
					background: false,
					live: false,
					attention: [],
					startedAt: 1,
					completedAt: 5,
					error: "boom",
				},
			],
		});
		expect(chats.reads).toContain("team ses_root /repo");
	});

	it("derives the roster on Kilo CLIs without one: subchats, statuses and last turns", async () => {
		const chats = rooted();
		chats.teams.ses_root = roster;
		chats.chats.push(
			desktopChat("ses_done", { directory: "/repo", parentId: "ses_root" }),
			desktopChat("ses_cut", { directory: "/repo", parentId: "ses_root" }),
			desktopChat("ses_busy", { directory: "/repo", parentId: "ses_root" }),
			desktopChat("ses_nested", { directory: "/repo", parentId: "ses_done" }),
		);
		chats.byDirectory = { "/repo": { statuses: { ses_busy: { type: "busy" } } } };
		chats.lastTurns = {
			ses_done: {
				role: "assistant",
				completedAt: 50,
				model: { providerID: "kilo", modelID: "haiku" },
			},
			ses_cut: { role: "assistant" },
			ses_nested: { role: "assistant", errorName: "APIError", errorMessage: "boom" },
		};
		const { swarm } = await boot(chats);

		const team = await swarm.methods.team({ chatId: "ses_root" });

		expect(chats.reads.some((read) => read.startsWith("team "))).toBe(false);
		const byId = Object.fromEntries(team!.members.map((member) => [member.chatId, member]));
		expect(Object.keys(byId).toSorted()).toEqual(["ses_busy", "ses_cut", "ses_done", "ses_nested"]);
		expect(byId.ses_done).toMatchObject({
			state: "completed",
			completedAt: 50,
			model: "kilo/haiku",
			parentChatId: "ses_root",
		});
		expect(byId.ses_done?.background).toBeUndefined();
		expect(byId.ses_cut?.state).toBe("offline");
		expect(byId.ses_busy?.state).toBe("busy");
		expect(byId.ses_nested).toMatchObject({
			state: "error",
			error: "boom",
			parentChatId: "ses_done",
		});

		// An unchanged worker's last turn is read once.
		const before = chats.reads.filter((read) => read === "last ses_done").length;
		await swarm.methods.team({ chatId: "ses_root" });
		expect(chats.reads.filter((read) => read === "last ses_done").length).toBe(before);
	});

	it("dates a derived worker's finish by its final turn, not a step that finished while it worked", async () => {
		const chats = rooted();
		const worker = desktopChat("ses_worker", {
			directory: "/repo",
			parentId: "ses_root",
			updatedAt: 1_000,
		});
		chats.chats.push(worker);
		// Mid-run: the newest message is a finished step, while the server still says busy.
		chats.byDirectory = { "/repo": { statuses: { ses_worker: { type: "busy" } } } };
		chats.lastTurns = { ses_worker: { role: "assistant", completedAt: 1_000 } };
		const { swarm } = await boot(chats);
		expect((await swarm.methods.team({ chatId: "ses_root" }))!.members[0]).toMatchObject({
			state: "busy",
		});

		// It finishes minutes later: idle, a newer final turn, and the chat updated.
		chats.byDirectory = { "/repo": { statuses: {} } };
		chats.lastTurns = { ses_worker: { role: "assistant", completedAt: 300_000 } };
		chats.chats.splice(chats.chats.indexOf(worker), 1, { ...worker, updatedAt: 300_000 });

		expect((await swarm.methods.team({ chatId: "ses_root" }))!.members[0]).toMatchObject({
			state: "completed",
			completedAt: 300_000,
		});
	});
});

describe("kilo.core/swarm shared agent board setting", () => {
	async function bootWithCallers(chats: FakeKiloChats) {
		const agent = await bootAgent({
			chats,
			waitForServer: true,
			plugins: [testPlugin("kilo.chat"), testPlugin("acme.other")],
		});
		const as = (pluginId: string) => agent.kernel.sdkFor(pluginId).domainObjects.get(Swarm)!;
		return {
			...agent,
			swarm: agent.kernel.kernelSdk.domainObjects.get(Swarm)!,
			asChat: as("kilo.chat"),
			asOther: as("acme.other"),
		};
	}

	it("is on, read when the server connects, while the user's config doesn't turn it off", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);

		await eventually(() => expect(swarm.getState().enabled).toBe(true));
	});

	it("follows the user's config each time the server connects again", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);
		await eventually(() => expect(swarm.getState().enabled).toBe(true));

		chats.globalConfigValues = { shared_agent_board: false };
		chats.push({ type: "server.connected", properties: {} });

		await eventually(() => expect(swarm.getState().enabled).toBe(false));
	});

	it("is off when the user's global config sets shared_agent_board to false", async () => {
		const chats = rooted();
		chats.globalConfigValues = { shared_agent_board: false };
		const { swarm } = await boot(chats);

		await eventually(() => expect(swarm.getState().enabled).toBe(false));
	});

	it("writes shared_agent_board into the user's global config and reads it back", async () => {
		const chats = rooted();
		chats.globalConfigValues = { model: "kilo/auto" };
		const { asChat, swarm } = await bootWithCallers(chats);

		await asChat.methods.setEnabled({ enabled: false });

		expect(chats.globalConfigUpdates).toEqual([{ shared_agent_board: false }]);
		expect(chats.globalConfigValues).toEqual({ model: "kilo/auto", shared_agent_board: false });
		expect(swarm.getState().enabled).toBe(false);

		await asChat.methods.setEnabled({ enabled: true });
		expect(swarm.getState().enabled).toBe(true);
	});

	it("explains a refused write with Kilo's own message", async () => {
		const chats = rooted();
		chats.failNextGlobalConfigUpdate = new Error("The config file is read-only.");
		const { asChat, swarm } = await bootWithCallers(chats);

		await expect(asChat.methods.setEnabled({ enabled: false })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The config file is read-only.",
		} satisfies Partial<KernelError>);
		expect(swarm.getState().enabled).not.toBe(false);
	});

	it("is changed only by kilo.core, kilo.chat and the main kernel", async () => {
		const chats = rooted();
		const { asOther, kernel } = await bootWithCallers(chats);

		await expect(asOther.methods.setEnabled({ enabled: false })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		expect(chats.globalConfigUpdates).toEqual([]);

		await kernel.kernelSdk.domainObjects.get(Swarm)!.methods.setEnabled({ enabled: false });
		expect(chats.globalConfigUpdates).toEqual([{ shared_agent_board: false }]);
	});
});

describe("kilo.core/swarm usage", () => {
	it("reads the cost of the chat's whole tree and of its own subtree, in its directory", async () => {
		const chats = rooted();
		chats.usages.ses_root = {
			sessionIDs: ["ses_root", "ses_child"],
			sessionCost: 0.25,
			totals: {
				steps: 7,
				cost: 1.5,
				tokens: { input: 1200, output: 340, reasoning: 50, cache: { read: 900, write: 10 } },
			},
			models: [],
		};
		const { swarm } = await boot(chats);

		expect(await swarm.methods.usage({ chatId: "ses_root" })).toEqual({
			cost: 1.5,
			ownCost: 0.25,
			tokens: { input: 1200, output: 340 },
		});
		expect(chats.reads).toContain("usage ses_root /repo");
	});

	it("leaves out the subtree's cost when Kilo doesn't say it", async () => {
		const chats = rooted();
		chats.usages.ses_root = {
			sessionIDs: ["ses_root"],
			totals: {
				steps: 1,
				cost: 0,
				tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
			},
			models: [],
		};
		const { swarm } = await boot(chats);

		expect(await swarm.methods.usage({ chatId: "ses_root" })).toEqual({
			cost: 0,
			tokens: { input: 1, output: 2 },
		});
	});

	it("is null when the server has no usage for the chat", async () => {
		const chats = rooted();
		const { swarm } = await boot(chats);

		expect(await swarm.methods.usage({ chatId: "ses_root" })).toBeNull();
	});
});
