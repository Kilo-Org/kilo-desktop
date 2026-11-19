import { describe, expect, it } from "vitest";

import type { BackgroundJob, BoardMessage, ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import { participantName, rosterTeam, swarmTeam, teamIsWorking } from "./swarm-team";

const chat = (id: string, patch: Partial<ChatSummary> = {}): ChatSummary => ({
	id,
	title: id,
	directory: "/repo",
	parentId: null,
	workSessionId: "ws",
	workspaceId: "w",
	worktreeBranch: null,
	workspaceFolders: [],
	createdAt: 1,
	updatedAt: 1,
	activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
	...patch,
});

const job = (id: string, patch: Partial<BackgroundJob> = {}): BackgroundJob => ({
	id,
	type: "task",
	status: "running",
	startedAt: 1,
	...patch,
});

describe("swarmTeam", () => {
	it("lists the root first, then its descendants in the order they started", () => {
		const chats = {
			root: chat("root", { title: "Map conda" }),
			b: chat("b", { parentId: "root", title: "Map bridge RPC", createdAt: 3 }),
			a: chat("a", { parentId: "root", title: "Map environments", createdAt: 2 }),
			nested: chat("nested", { parentId: "a", title: "Grep", createdAt: 4 }),
			other: chat("other", { title: "Unrelated" }),
		};

		expect(swarmTeam("root", chats, []).map((member) => member.chatId)).toEqual([
			"root",
			"a",
			"b",
			"nested",
		]);
	});

	it("says what each worker is doing, from live activity, its job, then its last turn", () => {
		const activity = (patch: Partial<ChatSummary["activity"]>) => ({
			status: "idle" as const,
			pendingPermissionIds: [],
			pendingQuestionIds: [],
			...patch,
		});
		const chats = {
			root: chat("root"),
			busy: chat("busy", { parentId: "root", activity: activity({ status: "busy" }) }),
			retry: chat("retry", { parentId: "root", activity: activity({ status: "retry" }) }),
			jobDone: chat("jobDone", { parentId: "root" }),
			jobCancelled: chat("jobCancelled", { parentId: "root" }),
			jobFailed: chat("jobFailed", { parentId: "root" }),
			watched: chat("watched", { parentId: "root", activity: activity({ completedAt: 9 }) }),
			failed: chat("failed", {
				parentId: "root",
				activity: activity({ lastError: { name: "E", message: "boom" } }),
			}),
			silent: chat("silent", { parentId: "root" }),
		};

		const team = swarmTeam("root", chats, [
			job("j1", { chatId: "jobDone", status: "completed", completedAt: 7 }),
			job("j2", { chatId: "jobCancelled", status: "cancelled" }),
			job("j3", { chatId: "jobFailed", status: "error", error: "rate limited" }),
		]);
		const states = Object.fromEntries(team.map((member) => [member.chatId, member.state]));

		expect(states).toEqual({
			root: "idle",
			busy: "working",
			retry: "retrying",
			jobDone: "done",
			jobCancelled: "cancelled",
			jobFailed: "failed",
			watched: "done",
			failed: "failed",
			silent: "unknown",
		});
		const byId = new Map(team.map((member) => [member.chatId, member]));
		expect(byId.get("jobDone")).toMatchObject({ completedAt: 7, background: true });
		expect(byId.get("jobFailed")?.error).toBe("rate limited");
		expect(byId.get("failed")?.error).toBe("boom");
		expect(byId.get("silent")).toMatchObject({ background: false, startedAt: 1 });
	});

	it("flags a member waiting for the person whatever it is doing", () => {
		const chats = {
			root: chat("root"),
			asking: chat("asking", {
				parentId: "root",
				activity: { status: "busy", pendingPermissionIds: ["p1"], pendingQuestionIds: [] },
			}),
		};
		const [, asking] = swarmTeam("root", chats, []);
		expect(asking).toMatchObject({ state: "working", needsYou: true });
	});

	it("takes the agent type kilo.core records, else its background job's", () => {
		const chats = {
			root: chat("root"),
			recorded: chat("recorded", { parentId: "root", agent: "general" }),
			fromJob: chat("fromJob", { parentId: "root", createdAt: 2 }),
		};
		const [, recorded, fromJob] = swarmTeam("root", chats, [
			job("j", { chatId: "fromJob", agent: "explore", model: "kilo/haiku" }),
		]);
		expect(recorded?.agent).toBe("general");
		expect(fromJob).toMatchObject({ agent: "explore", model: "kilo/haiku", jobId: "j" });
	});

	it("is empty without the root chat", () => {
		expect(swarmTeam("missing", {}, [])).toEqual([]);
	});
});

describe("teamIsWorking", () => {
	it("is true while any member works or a background job runs", () => {
		const chats = { root: chat("root"), child: chat("child", { parentId: "root" }) };
		expect(teamIsWorking(swarmTeam("root", chats, []), [])).toBe(false);
		expect(teamIsWorking(swarmTeam("root", chats, []), [job("j")])).toBe(true);
		expect(
			teamIsWorking(
				swarmTeam(
					"root",
					{
						...chats,
						child: chat("child", {
							parentId: "root",
							activity: { status: "retry", pendingPermissionIds: [], pendingQuestionIds: [] },
						}),
					},
					[],
				),
				[],
			),
		).toBe(true);
	});
});

describe("participantName", () => {
	const team = swarmTeam(
		"root",
		{
			root: chat("root", { title: "Map conda" }),
			child: chat("child", { parentId: "root", title: "Bridge RPC" }),
		},
		[],
	);
	const message = (patch: Partial<BoardMessage>): BoardMessage => ({
		id: "m",
		timestamp: 1,
		from: "child",
		to: "main",
		type: "INFO",
		body: "",
		...patch,
	});

	it("names the main agent, everyone, the person, team members by title, and falls back to Kilo's label", () => {
		expect(participantName("main", undefined, team)).toBe("Main agent");
		expect(participantName("root", undefined, team)).toBe("Main agent");
		expect(participantName("ALL", undefined, team)).toBe("Everyone");
		expect(participantName("user", "User", team)).toBe("You");
		expect(participantName("child", "kilo label", team)).toBe("Bridge RPC");
		expect(participantName("ses_gone", "Map env…", team)).toBe("Map env…");
		expect(participantName("ses_gone", undefined, team)).toBe("A finished agent");
		void message;
	});
});

describe("rosterTeam", () => {
	const member = (chatId: string, patch: Record<string, unknown> = {}) => ({
		chatId,
		parentChatId: "root",
		title: chatId,
		directory: "/repo",
		state: "completed" as const,
		background: true,
		live: false,
		attention: [] as ("question" | "permission")[],
		startedAt: 1,
		...patch,
	});

	it("puts the main agent first, then Kilo's workers with their agent, model and job", () => {
		const team = rosterTeam(
			"root",
			{ root: chat("root", { title: "Map conda" }) },
			{
				truncated: false,
				members: [
					member("a", { state: "busy", live: true, agent: "explore", model: "kilo/haiku" }),
					member("b", { state: "offline" }),
					member("c", { state: "error" }),
					member("d", { attention: ["question"] }),
					member("e", { state: "unknown" }),
					member("f", { state: "retry" }),
					member("g", { state: "cancelled", completedAt: 4 }),
				],
			},
			[],
		);

		expect(team.map((m) => [m.chatId, m.state])).toEqual([
			["root", "idle"],
			["a", "working"],
			["b", "stopped"],
			["c", "failed"],
			["d", "done"],
			["e", "unknown"],
			["f", "retrying"],
			["g", "cancelled"],
		]);
		expect(team[4]?.needsYou).toBe(true);
		expect(team[7]?.completedAt).toBe(4);
		expect(team[0]).toMatchObject({ main: true, title: "Map conda" });
		expect(team[1]).toMatchObject({ agent: "explore", model: "kilo/haiku", jobId: "a" });
		expect(team[2]?.jobId).toBeUndefined();
	});
});

describe("displayTitle", () => {
	it("drops the task suffix Kilo names a subagent's chat with", async () => {
		const { displayTitle } = await import("./swarm-team");
		expect(displayTitle("Map bridge RPC (@explore subagent)")).toBe("Map bridge RPC");
		expect(displayTitle("Plain title")).toBe("Plain title");
	});
});
