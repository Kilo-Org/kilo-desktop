import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin, type DomainProvider, type PluginSdk } from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import agentManifest from "@kilo-desktop/plugin-agent/plugin.json";
import {
	AGENT_DEFINITIONS,
	Conversations,
	type ChatSummary,
} from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	Sessions,
	SESSIONS_DEFINITIONS,
	type Session,
} from "@kilo-desktop/plugin-sessions/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Vcs,
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../../plugin.json";
import { GIT_DEFINITIONS, Repository } from "../../contracts/index.js";
import { createGitMainEntry } from "../entry.js";

const WAIT = { timeout: 15_000 };
const directories: string[] = [];
const kernels: MainKernel[] = [];

afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function initRepo(): string {
	// `.native` expands Windows 8.3 short names (RUNNER~1 in CI's TEMP) to the
	// long form git reports for the worktrees it creates.
	const repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-namer-")));
	directories.push(repoDir);
	const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
	git(["init", "-b", "main"]);
	git(["config", "user.email", "git-plugin@example.com"]);
	git(["config", "user.name", "Git Plugin Test"]);
	git(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
	return repoDir;
}

const currentBranch = (directory: string) =>
	execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: directory, stdio: "pipe" })
		.toString()
		.trim();

function realpathOr(target: string): string {
	try {
		return fs.realpathSync.native(target);
	} catch {
		return path.resolve(target);
	}
}

/** Whether `candidate` is `folder` or inside it once both are resolved, like kilo.workspaces. */
function isInside(folder: string, candidate: string): boolean {
	const inside = path.relative(realpathOr(folder), realpathOr(candidate));
	return (
		inside === "" ||
		(!inside.startsWith(`..${path.sep}`) && inside !== ".." && !path.isAbsolute(inside))
	);
}

const nothingDone = () => new Promise((resolve) => setTimeout(resolve, 100));

function session(id: string, patch: Partial<Session> = {}): Session {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		worktreeBranch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

function chat(id: string, directory: string, patch: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: "Chat",
		directory,
		parentId: null,
		workspaceId: "w1",
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 0,
		updatedAt: 0,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

interface Recorded {
	generated: { chatId: string; prompt: string; model?: unknown }[];
	sessionBranches: { id: string; branch: string }[];
	chatBranches: { id: string; branch: string }[];
	renamedEvents: { directory: string; branch: string }[];
}

async function boot(options: {
	folder: string;
	sessions?: Session[];
	chats?: ChatSummary[];
	storage?: ReturnType<typeof createMemoryStorage>;
	names?: (string | null)[];
}) {
	const storage = options.storage ?? createMemoryStorage();
	const recorded: Recorded = {
		generated: [],
		sessionBranches: [],
		chatBranches: [],
		renamedEvents: [],
	};
	const names = [...(options.names ?? [])];
	let sessions!: DomainProvider<typeof Sessions>;
	let conversations!: DomainProvider<typeof Conversations>;
	let consumer: PluginSdk | undefined;
	const unused = () => {
		throw new Error("unused");
	};
	const workspace: Workspace = {
		id: "w1",
		name: "App",
		folders: [{ id: "f1", path: options.folder, isPrimary: true, position: 0 }],
		createdAt: 0,
		updatedAt: 0,
	};
	const kernel = createMainKernel({
		host: createTestHost(),
		hostServices: (pluginId) => (pluginId === manifest.id ? { storage } : {}),
		registrations: [
			{
				manifest: workspacesManifest,
				definitions: WORKSPACES_DEFINITIONS,
				entry: definePlugin({
					activate: (sdk) => {
						sdk.domains.provide(Workspaces, {
							initialState: { workspaces: [workspace], activeId: "w1", unavailableFolderIds: [] },
							methods: {
								create: unused,
								update: unused,
								remove: unused,
								setActive: unused,
								checkFolders: unused,
								authorize: ({ path: target }) =>
									isInside(options.folder, target)
										? { allowed: true, folder: options.folder, path: target }
										: { allowed: false },
							},
						});
					},
				}),
			},
			{
				manifest: sessionsManifest,
				definitions: SESSIONS_DEFINITIONS,
				entry: definePlugin({
					activate: (sdk) => {
						sessions = sdk.domains.provide(Sessions, {
							initialState: { sessions: options.sessions ?? [] },
							methods: {
								create: unused,
								rename: unused,
								setPinned: unused,
								setArchived: unused,
								remove: unused,
								isolationOptions: unused,
								importLegacyPins: unused,
								setWorktreeBranch: ({ id, branch }) => {
									recorded.sessionBranches.push({ id, branch });
									const list = sessions.state.sessions.map((candidate) =>
										candidate.id === id ? { ...candidate, worktreeBranch: branch } : candidate,
									);
									sessions.setState({ sessions: list });
									return list.find((candidate) => candidate.id === id)!;
								},
							},
						});
					},
				}),
			},
			{
				manifest: agentManifest,
				definitions: AGENT_DEFINITIONS,
				entry: definePlugin({
					activate: (sdk) => {
						conversations = sdk.domains.provide(Conversations, {
							initialState: {
								ready: true,
								chats: Object.fromEntries((options.chats ?? []).map((c) => [c.id, c])),
							},
							methods: {
								create: unused,
								generate: unused,
								sessionConfig: unused,
								rename: unused,
								delete: unused,
								abort: unused,
								setArchived: unused,
								permissionRequests: unused,
								replyPermission: unused,
								replyQuestion: unused,
								rejectQuestion: unused,
								generateBranchName: (input) => {
									recorded.generated.push(input);
									return { branch: names.length > 0 ? names.shift()! : "fix-the-login-bug" };
								},
								setWorktreeBranch: ({ id, branch }) => {
									recorded.chatBranches.push({ id, branch });
								},
							},
						});
					},
				}),
			},
			testPlugin("test.consumer", {
				manifest: { requires: { "kilo.workspaces/vcs": "optional" } },
				entry: { activate: (sdk) => void (consumer = sdk) },
			}),
			{ manifest, definitions: GIT_DEFINITIONS, entry: createGitMainEntry() },
		],
	});
	kernels.push(kernel);
	await kernel.start();
	kernel.kernelSdk.domains
		.get(Repository)!
		.on("worktree-branch-renamed", (payload) => recorded.renamedEvents.push(payload));
	const vcs = () => consumer!.extensions.exclusive(Vcs).winner!.implementation!;

	const setChatStatus = (chatId: string, status: "idle" | "busy") => {
		const current = conversations.state.chats[chatId]!;
		conversations.setState({
			...conversations.state,
			chats: {
				...conversations.state.chats,
				[chatId]: { ...current, activity: { ...current.activity, status } },
			},
		});
	};
	return {
		kernel,
		storage,
		recorded,
		vcs,
		/** The chat joins its session, as kilo.sessions reports it. */
		join(sessionId: string, chatId: string, directory: string) {
			conversations.setState({
				...conversations.state,
				chats: { ...conversations.state.chats, [chatId]: chat(chatId, directory) },
			});
			const before = sessions.state.sessions.find((candidate) => candidate.id === sessionId)!;
			const after = { ...before, chatIds: [...before.chatIds, chatId] };
			sessions.setState({
				sessions: sessions.state.sessions.map((candidate) =>
					candidate.id === sessionId ? after : candidate,
				),
			});
			sessions.emit("updated", { before, after });
		},
		send(chatId: string, text: string) {
			conversations.emit("user-message", { chatId, messageId: `msg_${text}`, text });
		},
		/** One turn of the chat, started by `text` unless the agent carries on by itself. */
		async turn(chatId: string, text?: string, during?: () => void) {
			if (text !== undefined) this.send(chatId, text);
			setChatStatus(chatId, "busy");
			conversations.emit("turn-started", { chatId });
			await new Promise((resolve) => setTimeout(resolve, 10));
			during?.();
			setChatStatus(chatId, "idle");
			conversations.emit("turn-ended", { chatId });
		},
		deleteSession(sessionId: string) {
			const deleted = sessions.state.sessions.find((candidate) => candidate.id === sessionId)!;
			sessions.setState({
				sessions: sessions.state.sessions.filter((candidate) => candidate.id !== sessionId),
			});
			sessions.emit("deleted", { session: deleted });
		},
	};
}

async function worktreeSession(repoDir: string) {
	const host = await boot({ folder: repoDir });
	const worktree = await host.vcs().createWorktree({ directory: repoDir });
	await host.kernel.stop();
	return worktree;
}

describe("the worktree branch namer", () => {
	it("renames a new worktree's branch on the second prompt and records it everywhere", async () => {
		const repoDir = initRepo();
		const worktree = await worktreeSession(repoDir);
		const host = await boot({
			folder: repoDir,
			sessions: [
				session("wses_1", {
					worktreeCreated: true,
					directory: worktree.directory,
					worktreeBranch: worktree.branch,
				}),
			],
		});
		host.join("wses_1", "ses_1", worktree.directory);

		host.send("ses_1", "hello");
		await nothingDone();
		expect(host.recorded.generated).toEqual([]);
		host.send("ses_1", "fix the login bug");

		await vi.waitFor(() => expect(host.recorded.chatBranches).toHaveLength(1), WAIT);
		expect(host.recorded.generated).toEqual([{ chatId: "ses_1", prompt: "fix the login bug" }]);
		expect(currentBranch(worktree.directory)).toBe("kilo/fix-the-login-bug");
		expect(host.recorded.sessionBranches).toEqual([
			{ id: "wses_1", branch: "kilo/fix-the-login-bug" },
		]);
		expect(host.recorded.chatBranches).toEqual([{ id: "ses_1", branch: "kilo/fix-the-login-bug" }]);
		expect(host.recorded.renamedEvents).toEqual([
			{ directory: worktree.directory, branch: "kilo/fix-the-login-bug" },
		]);
		expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} });
	});

	it("names from a single prompt once its turn ends with work in the worktree", async () => {
		const repoDir = initRepo();
		const worktree = await worktreeSession(repoDir);
		const host = await boot({
			folder: repoDir,
			sessions: [
				session("wses_1", {
					worktreeCreated: true,
					directory: worktree.directory,
					worktreeBranch: worktree.branch,
				}),
			],
		});
		host.join("wses_1", "ses_1", worktree.directory);

		await host.turn("ses_1", "build the login page");
		await nothingDone();
		expect(host.recorded.generated).toEqual([]);

		await host.turn("ses_1", undefined, () =>
			fs.writeFileSync(path.join(worktree.directory, "login.ts"), "export {};\n"),
		);
		await vi.waitFor(() => expect(host.recorded.chatBranches).toHaveLength(1), WAIT);

		expect(host.recorded.generated).toEqual([{ chatId: "ses_1", prompt: "" }]);
		expect(currentBranch(worktree.directory)).toBe("kilo/fix-the-login-bug");
	});

	it("leaves branches alone outside kilo/, in shared directories and in picked worktrees", async () => {
		const repoDir = initRepo();
		const shared = `${repoDir}/.kilo/worktrees/shared`;
		const host = await boot({
			folder: repoDir,
			sessions: [
				session("wses_feature", {
					worktreeCreated: true,
					directory: `${repoDir}/.kilo/worktrees/feature`,
					worktreeBranch: "feature",
				}),
				session("wses_shared", {
					worktreeCreated: true,
					directory: shared,
					worktreeBranch: "kilo/shared",
				}),
				session("wses_other", { directory: shared, worktreeBranch: "kilo/shared" }),
				session("wses_picked", {
					directory: `${repoDir}/.kilo/worktrees/picked`,
					worktreeBranch: "kilo/picked",
				}),
			],
		});
		host.join("wses_feature", "ses_feature", `${repoDir}/.kilo/worktrees/feature`);
		host.join("wses_shared", "ses_shared", shared);
		host.join("wses_picked", "ses_picked", `${repoDir}/.kilo/worktrees/picked`);

		for (const chatId of ["ses_feature", "ses_shared", "ses_picked"]) {
			await host.turn(chatId, "hello");
			await host.turn(chatId, "fix the login bug");
		}
		await nothingDone();

		expect(host.recorded.generated).toEqual([]);
		expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} });
	});

	it("keeps its progress across a restart and never renames twice", async () => {
		const repoDir = initRepo();
		const worktree = await worktreeSession(repoDir);
		const storage = createMemoryStorage();
		const placed = session("wses_1", {
			worktreeCreated: true,
			directory: worktree.directory,
			worktreeBranch: worktree.branch,
		});
		const first = await boot({ folder: repoDir, sessions: [placed], storage });
		first.join("wses_1", "ses_1", worktree.directory);
		first.send("ses_1", "hello");
		await vi.waitFor(
			() =>
				expect(storage.saved.get("branch-namer")).toEqual({
					armed: { ses_1: { promptCount: 1, idleAttempted: false } },
				}),
			WAIT,
		);
		await first.kernel.stop();

		const linked = { ...placed, chatIds: ["ses_1"] };
		const chats = [chat("ses_1", worktree.directory)];
		const second = await boot({ folder: repoDir, sessions: [linked], chats, storage });
		second.send("ses_1", "fix the login bug");
		await vi.waitFor(() => expect(second.recorded.chatBranches).toHaveLength(1), WAIT);
		await second.turn("ses_1", "and the logout");
		await second.kernel.stop();

		const renamed = { ...linked, worktreeBranch: "kilo/fix-the-login-bug" };
		const third = await boot({
			folder: repoDir,
			sessions: [renamed],
			chats,
			storage,
			names: ["something-else"],
		});
		await third.turn("ses_1", "one more");
		await third.turn("ses_1", "and another");
		await nothingDone();

		expect(third.recorded.generated).toEqual([]);
		expect(currentBranch(worktree.directory)).toBe("kilo/fix-the-login-bug");
	});

	it("forgets the chats of a deleted session", async () => {
		const repoDir = initRepo();
		const directory = `${repoDir}/.kilo/worktrees/gone`;
		const host = await boot({
			folder: repoDir,
			sessions: [session("wses_1", { worktreeCreated: true, directory, worktreeBranch: "kilo/x" })],
		});
		host.join("wses_1", "ses_1", directory);
		await vi.waitFor(
			() =>
				expect(Object.keys(host.storage.saved.get("branch-namer")?.armed ?? {})).toEqual(["ses_1"]),
			WAIT,
		);

		host.deleteSession("wses_1");

		await vi.waitFor(
			() => expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} }),
			WAIT,
		);
	});
});
