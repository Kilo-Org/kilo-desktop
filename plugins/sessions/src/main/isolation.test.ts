import { describe, expect, it, vi } from "vitest";

import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { isOrphanedWorktreeSession, WorkSessions, SESSIONS_DEFINITIONS } from "../contracts";
import { chat, FakeConversations, fakeWorkspaces, FakeVcs } from "../test/main-fakes";
import { createSessionsMainEntry } from "./entry";
import { worktreeChatLinks } from "./isolation";

const WORKTREE = "/projects/app/.kilo/worktrees/brave-fox";
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 5_000 });

async function boot(
	options: { vcs?: boolean; storage?: ReturnType<typeof createMemoryStorage> } = {},
) {
	const log: string[] = [];
	const kilo = new FakeConversations(log);
	const vcs = new FakeVcs(log);
	let id = 0;
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			kilo.registration,
			fakeWorkspaces().registration,
			...(options.vcs === false ? [] : [vcs.registration]),
			{
				manifest,
				definitions: SESSIONS_DEFINITIONS,
				entry: createSessionsMainEntry({ createId: () => `wses_${++id}` }),
			},
		],
		hostServices: () => ({
			storage: options.storage ?? createMemoryStorage("/data/kilo.sessions"),
		}),
	});
	await kernel.start();
	const sessions = kernel.kernelSdk.domains.get(WorkSessions)!;
	const byId = (sessionId: string) =>
		sessions.getState().sessions.find((session) => session.id === sessionId);
	return { kernel, sessions, kilo, vcs, log, byId };
}

describe("creating a session with isolation", () => {
	it("works in the workspace's checkout when local", async () => {
		const { sessions, log } = await boot();

		const created = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "local" },
		});

		expect(created).toMatchObject({ isolation: "local", directory: null, worktreeBranch: null });
		expect(created.worktreeCreated).toBeUndefined();
		expect(log).toEqual([]);
	});

	it("creates a worktree in the workspace's primary folder, from the chosen base", async () => {
		const { sessions, log } = await boot();

		const created = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-worktree", baseBranch: "develop" },
		});

		expect(log).toEqual(["create /projects/app from develop"]);
		expect(created).toMatchObject({
			isolation: "new-worktree",
			directory: WORKTREE,
			worktreeBranch: "kilo/brave-fox",
			baseRef: "origin/develop",
			worktreeCreated: true,
		});
	});

	it("records a renamed worktree branch, only for a session in a worktree", async () => {
		const { sessions, byId } = await boot();
		const placed = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-worktree" },
		});
		const local = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "local" },
		});

		await sessions.methods.setWorktreeBranch({ id: placed.id, branch: "kilo/fix-login" });

		expect(byId(placed.id)?.worktreeBranch).toBe("kilo/fix-login");
		await expect(
			sessions.methods.setWorktreeBranch({ id: local.id, branch: "kilo/x" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			sessions.methods.setWorktreeBranch({ id: "wses_gone", branch: "kilo/x" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("uses an existing worktree without claiming it", async () => {
		const { sessions, log } = await boot();

		const created = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "existing-worktree", directory: "/projects/app/.kilo/worktrees/old" },
		});

		expect(log).toEqual(["resolve /projects/app/.kilo/worktrees/old in /projects/app"]);
		expect(created).toMatchObject({
			isolation: "existing-worktree",
			directory: "/projects/app/.kilo/worktrees/old",
			worktreeBranch: "kilo/old",
		});
		expect(created.worktreeCreated).toBeUndefined();
	});

	it("creates no session when the worktree can't be made, saying why", async () => {
		const { sessions, vcs } = await boot();
		vcs.failCreate = true;

		await expect(
			sessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-worktree" } }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Could not create the worktree: worktree add failed",
		});
		await expect(
			sessions.methods.create({
				workspaceId: "w1",
				isolation: { kind: "existing-worktree", directory: "/elsewhere" },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(sessions.getState().sessions).toEqual([]);
	});

	it("never falls back to the checkout for a worktree it can't place", async () => {
		const { sessions } = await boot({ vcs: false });

		await expect(
			sessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-worktree" } }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			sessions.methods.create({ isolation: { kind: "new-worktree" } }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			sessions.methods.create({ workspaceId: "w9", isolation: { kind: "new-worktree" } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("removes the worktree it created when the session can't be saved", async () => {
		const failing = createMemoryStorage("/data/kilo.sessions");
		const kv = failing.kv.bind(failing);
		failing.kv = ((options) => ({
			...kv(options),
			set: () => {
				throw new Error("disk full");
			},
		})) as typeof failing.kv;
		const { sessions, log } = await boot({ storage: failing });

		await expect(
			sessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-worktree" } }),
		).rejects.toMatchObject({ code: "INTERNAL", message: expect.stringContaining("disk full") });
		expect(log).toEqual(["create /projects/app from default", `remove ${WORKTREE}`]);
	});

	it("keeps an isolated session's place whatever its chats report", async () => {
		const { sessions, kilo, byId } = await boot();
		const { id } = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-worktree" },
		});

		kilo.upsert(
			chat("ses_a", { workSessionId: id, directory: "/projects/app", worktreeBranch: null }),
		);

		await eventually(() => expect(byId(id)?.chatIds).toEqual(["ses_a"]));
		expect(byId(id)).toMatchObject({ directory: WORKTREE, worktreeBranch: "kilo/brave-fox" });
	});
});

describe("isolation options", () => {
	it("lists the workspace's branches and other worktrees", async () => {
		const { sessions } = await boot();

		await expect(sessions.methods.isolationOptions({ workspaceId: "w1" })).resolves.toEqual({
			directory: "/projects/app",
			currentBranch: "main",
			defaultBranch: "main",
			branches: [
				{ name: "main", kind: "local", ref: "refs/heads/main", upstream: null },
				{
					name: "origin/feature",
					kind: "remote",
					ref: "refs/remotes/origin/feature",
					upstream: null,
				},
			],
			recentBranches: ["main"],
			worktrees: [
				{ directory: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old" },
			],
		});
	});

	it("offers nothing without version control, a repository or the workspace", async () => {
		const withoutVcs = await boot({ vcs: false });
		const { sessions, vcs } = await boot();
		vcs.branchesResult = null;

		await expect(withoutVcs.sessions.methods.isolationOptions({ workspaceId: "w1" })).resolves.toBe(
			null,
		);
		await expect(sessions.methods.isolationOptions({ workspaceId: "w1" })).resolves.toBeNull();
		await expect(sessions.methods.isolationOptions({ workspaceId: "w9" })).resolves.toBeNull();
	});
});

describe("removing a session's worktree", () => {
	async function worktreeSession() {
		const booted = await boot();
		const { id } = await booted.sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-worktree" },
		});
		booted.kilo.upsert(chat("ses_a", { workSessionId: id, directory: WORKTREE }));
		await eventually(() => expect(booted.byId(id)?.chatIds).toEqual(["ses_a"]));
		booted.log.length = 0;
		return { ...booted, id };
	}

	it("deletes the chats, releases the Kilo instance, then removes the worktree", async () => {
		const { sessions, log, id } = await worktreeSession();

		await expect(sessions.methods.remove({ id, removeWorktree: true })).resolves.toEqual({
			deleted: true,
			worktreeRemoved: true,
		});

		expect(log).toEqual(["delete chat ses_a", `dispose ${WORKTREE}`, `remove ${WORKTREE}`]);
	});

	it("keeps the worktree unless asked", async () => {
		const { sessions, log, id, kilo } = await worktreeSession();

		await expect(sessions.methods.remove({ id })).resolves.toEqual({ deleted: true });

		await eventually(() => expect(kilo.deleted).toEqual(["ses_a"]));
		expect(log).toEqual(["delete chat ses_a"]);
	});

	it("keeps a worktree another session still works in", async () => {
		const { sessions, log } = await boot();
		const isolation = {
			kind: "existing-worktree" as const,
			directory: "/projects/app/.kilo/worktrees/old",
		};
		const first = await sessions.methods.create({ workspaceId: "w1", isolation });
		const second = await sessions.methods.create({ workspaceId: "w1", isolation });
		log.length = 0;

		expect(isOrphanedWorktreeSession(sessions.getState().sessions, first.id)).toBe(false);
		await expect(sessions.methods.remove({ id: first.id, removeWorktree: true })).resolves.toEqual({
			deleted: true,
		});
		expect(log).toEqual([]);
		expect(isOrphanedWorktreeSession(sessions.getState().sessions, second.id)).toBe(true);
	});

	it("still removes the worktree when the instance can't be released, and reports a failed removal", async () => {
		const { sessions, kilo, vcs, log, id } = await worktreeSession();
		kilo.failDispose = true;
		vcs.failRemove = true;

		await expect(sessions.methods.remove({ id, removeWorktree: true })).resolves.toEqual({
			deleted: true,
			worktreeRemoved: false,
			worktreeError: "worktree is locked",
		});
		expect(log).toEqual(["delete chat ses_a", `dispose ${WORKTREE}`, `remove ${WORKTREE}`]);
		expect(sessions.getState().sessions).toEqual([]);
	});
});

describe("VS Code Agent Manager links", () => {
	it("links a worktree session's first chat, with the worktree's base", async () => {
		const { sessions, kilo, vcs, byId } = await boot();
		const { id } = await sessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-worktree" },
		});

		kilo.upsert(chat("ses_a", { workSessionId: id, directory: WORKTREE }));
		kilo.upsert(chat("ses_b", { workSessionId: id, directory: WORKTREE }));

		await eventually(() => expect(byId(id)?.chatIds).toEqual(["ses_a", "ses_b"]));
		expect(vcs.links).toEqual([
			{ directory: WORKTREE, sessionId: "ses_a", baseRef: "origin/main" },
		]);
	});

	it("backfills one chat per worktree on the first full read", async () => {
		const log: string[] = [];
		const kilo = new FakeConversations(log);
		kilo.chats = [
			chat("ses_old", { directory: "/wt/a", worktreeBranch: "kilo/a", updatedAt: 1 }),
			chat("ses_new", { directory: "/wt/a", worktreeBranch: "kilo/a", updatedAt: 2 }),
			chat("ses_plain", { directory: "/projects/app" }),
		];
		const vcs = new FakeVcs(log);
		const kernel = createMainKernel({
			host: createTestHost(),
			registrations: [
				kilo.registration,
				fakeWorkspaces().registration,
				vcs.registration,
				{ manifest, definitions: SESSIONS_DEFINITIONS, entry: createSessionsMainEntry({}) },
			],
			hostServices: () => ({ storage: createMemoryStorage("/data/kilo.sessions") }),
		});
		await kernel.start();

		await eventually(() =>
			expect(vcs.links).toEqual([{ directory: "/wt/a", sessionId: "ses_new" }]),
		);
		kilo.setReady(false);
		kilo.setReady(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(vcs.links).toHaveLength(1);
	});

	it("prefers a live chat over an archived one", () => {
		expect(
			worktreeChatLinks([
				chat("ses_live", { directory: "/wt/a", worktreeBranch: "kilo/a", updatedAt: 1 }),
				chat("ses_gone", {
					directory: "/wt/a",
					worktreeBranch: "kilo/a",
					updatedAt: 9,
					archivedAt: 9,
				}),
				chat("ses_child", { directory: "/wt/b", worktreeBranch: "kilo/b", parentId: "ses_live" }),
			]),
		).toEqual([{ directory: "/wt/a", chatId: "ses_live" }]);
	});
});
