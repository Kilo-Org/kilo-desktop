import { describe, expect, it, vi } from "vitest";

import { isOrphanedCopySession } from "../../contracts";
import { bootWorkSessions, chat, FakeCore, FakeVcs, storageWithWorkspaces } from "../test-boot";
import { copyChatLinks } from "./isolation";

const COPY = "/projects/app/.kilo/worktrees/brave-fox";
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 5_000 });

async function boot(
	options: { vcs?: boolean; storage?: ReturnType<typeof storageWithWorkspaces> } = {},
) {
	const log: string[] = [];
	const core = new FakeCore(log);
	const vcs = new FakeVcs(log);
	const booted = await bootWorkSessions({
		core,
		...(options.vcs === false ? {} : { vcs }),
		...(options.storage ? { storage: options.storage } : {}),
	});
	return { ...booted, core, vcs, log };
}

describe("creating a work session with isolation", () => {
	it("works in the workspace's checkout when local", async () => {
		const { workSessions, log } = await boot();

		const created = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "local" },
		});

		expect(created).toMatchObject({ isolation: "local", directory: null, branch: null });
		expect(created.copyCreated).toBeUndefined();
		expect(log).toEqual([]);
	});

	it("creates a copy in the workspace's primary folder, from the chosen base", async () => {
		const { workSessions, log } = await boot();

		const created = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy", baseBranch: "develop" },
		});

		expect(log).toEqual(["create /projects/app from develop"]);
		expect(created).toMatchObject({
			isolation: "new-copy",
			directory: COPY,
			branch: "kilo/brave-fox",
			baseRef: "origin/develop",
			copyCreated: true,
		});
	});

	it("records a renamed copy branch, rewriting its chats' stamps, only for a work session in a copy", async () => {
		const { workSessions, core, byId } = await boot();
		const placed = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy" },
		});
		const local = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "local" },
		});
		core.upsert(chat("ses_a", { workSessionId: placed.id, directory: COPY }));
		await eventually(() => expect(byId(placed.id)?.chatIds).toEqual(["ses_a"]));

		await workSessions.methods.setBranch({ id: placed.id, branch: "kilo/fix-login" });

		expect(byId(placed.id)?.branch).toBe("kilo/fix-login");
		await eventually(() => expect(core.branches).toEqual([["ses_a", "kilo/fix-login"]]));
		await expect(
			workSessions.methods.setBranch({ id: local.id, branch: "kilo/x" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			workSessions.methods.setBranch({ id: "wses_gone", branch: "kilo/x" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("uses an existing copy without claiming it", async () => {
		const { workSessions, log } = await boot();

		const created = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "existing-copy", directory: "/projects/app/.kilo/worktrees/old" },
		});

		expect(log).toEqual(["resolve /projects/app/.kilo/worktrees/old in /projects/app"]);
		expect(created).toMatchObject({
			isolation: "existing-copy",
			directory: "/projects/app/.kilo/worktrees/old",
			branch: "kilo/old",
		});
		expect(created.copyCreated).toBeUndefined();
	});

	it("creates no work session when the copy can't be made, saying why", async () => {
		const { workSessions, vcs } = await boot();
		vcs.failCreate = true;

		await expect(
			workSessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-copy" } }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Could not create the copy: worktree add failed",
		});
		await expect(
			workSessions.methods.create({
				workspaceId: "w1",
				isolation: { kind: "existing-copy", directory: "/elsewhere" },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(workSessions.getState().workSessions).toEqual([]);
	});

	it("never falls back to the checkout for a copy it can't place", async () => {
		const { workSessions } = await boot({ vcs: false });

		await expect(
			workSessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-copy" } }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			workSessions.methods.create({ isolation: { kind: "new-copy" } }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			workSessions.methods.create({ workspaceId: "w9", isolation: { kind: "new-copy" } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("removes the copy it created when the work session can't be saved", async () => {
		const failing = storageWithWorkspaces();
		const kv = failing.kv.bind(failing);
		failing.kv = ((options) =>
			options.namespace === "work-sessions"
				? {
						...kv(options),
						set: () => {
							throw new Error("disk full");
						},
					}
				: kv(options)) as typeof failing.kv;
		const { workSessions, log } = await boot({ storage: failing });

		await expect(
			workSessions.methods.create({ workspaceId: "w1", isolation: { kind: "new-copy" } }),
		).rejects.toMatchObject({ code: "INTERNAL", message: expect.stringContaining("disk full") });
		expect(log).toEqual(["create /projects/app from default", `remove ${COPY}`]);
	});

	it("keeps an isolated work session's place whatever its chats report", async () => {
		const { workSessions, core, byId } = await boot();
		const { id } = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy" },
		});

		core.upsert(
			chat("ses_a", { workSessionId: id, directory: "/projects/app", worktreeBranch: null }),
		);

		await eventually(() => expect(byId(id)?.chatIds).toEqual(["ses_a"]));
		expect(byId(id)).toMatchObject({ directory: COPY, branch: "kilo/brave-fox" });
	});

	it("creates its chats in the copy, on the copy's branch", async () => {
		const { workSessions, core } = await boot();
		const { id } = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy" },
		});

		await workSessions.methods.createChat({ id });

		expect(core.created[0]).toMatchObject({
			directory: COPY,
			worktreeBranch: "kilo/brave-fox",
			workspaceFolders: [
				{ path: "/projects/lib", isPrimary: false },
				{ path: COPY, isPrimary: true },
			],
		});
	});
});

describe("isolation options", () => {
	it("lists the workspace's branches and other copies", async () => {
		const { workSessions } = await boot();

		await expect(workSessions.methods.isolationOptions({ workspaceId: "w1" })).resolves.toEqual({
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
			copies: [{ directory: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old" }],
		});
	});

	it("offers nothing without version control, a repository or the workspace", async () => {
		const withoutVcs = await boot({ vcs: false });
		const { workSessions, vcs } = await boot();
		vcs.branchesResult = null;

		await expect(
			withoutVcs.workSessions.methods.isolationOptions({ workspaceId: "w1" }),
		).resolves.toBeNull();
		await expect(workSessions.methods.isolationOptions({ workspaceId: "w1" })).resolves.toBeNull();
		await expect(workSessions.methods.isolationOptions({ workspaceId: "w9" })).resolves.toBeNull();
	});
});

describe("removing a work session's copy", () => {
	async function copySession() {
		const booted = await boot();
		const { id } = await booted.workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy" },
		});
		booted.core.upsert(chat("ses_a", { workSessionId: id, directory: COPY }));
		await eventually(() => expect(booted.byId(id)?.chatIds).toEqual(["ses_a"]));
		booted.log.length = 0;
		return { ...booted, id };
	}

	it("deletes the chats, releases the Kilo instance, then removes the copy", async () => {
		const { workSessions, log, id } = await copySession();

		await expect(workSessions.methods.remove({ id, removeCopy: true })).resolves.toEqual({
			deleted: true,
			copyRemoved: true,
		});

		expect(log).toEqual(["delete chat ses_a", `dispose ${COPY}`, `remove ${COPY}`]);
	});

	it("keeps the copy unless asked", async () => {
		const { workSessions, log, id, core } = await copySession();

		await expect(workSessions.methods.remove({ id })).resolves.toEqual({ deleted: true });

		await eventually(() => expect(core.deleted).toEqual(["ses_a"]));
		expect(log).toEqual(["delete chat ses_a"]);
	});

	it("keeps a copy another work session still works in", async () => {
		const { workSessions, log } = await boot();
		const isolation = {
			kind: "existing-copy" as const,
			directory: "/projects/app/.kilo/worktrees/old",
		};
		const first = await workSessions.methods.create({ workspaceId: "w1", isolation });
		const second = await workSessions.methods.create({ workspaceId: "w1", isolation });
		log.length = 0;

		expect(isOrphanedCopySession(workSessions.getState().workSessions, first.id)).toBe(false);
		await expect(workSessions.methods.remove({ id: first.id, removeCopy: true })).resolves.toEqual({
			deleted: true,
		});
		expect(log).toEqual([]);
		expect(isOrphanedCopySession(workSessions.getState().workSessions, second.id)).toBe(true);
	});

	it("still removes the copy when the instance can't be released, and reports a failed removal", async () => {
		const { workSessions, core, vcs, log, id } = await copySession();
		core.failDispose = true;
		vcs.failRemove = true;

		await expect(workSessions.methods.remove({ id, removeCopy: true })).resolves.toEqual({
			deleted: true,
			copyRemoved: false,
			copyError: "worktree is locked",
		});
		expect(log).toEqual(["delete chat ses_a", `dispose ${COPY}`, `remove ${COPY}`]);
		expect(workSessions.getState().workSessions).toEqual([]);
	});
});

describe("VS Code Agent Manager links", () => {
	it("links a copy work session's first chat, with the copy's base", async () => {
		const { workSessions, core, vcs, byId } = await boot();
		const { id } = await workSessions.methods.create({
			workspaceId: "w1",
			isolation: { kind: "new-copy" },
		});

		core.upsert(chat("ses_a", { workSessionId: id, directory: COPY }));
		core.upsert(chat("ses_b", { workSessionId: id, directory: COPY }));

		await eventually(() => expect(byId(id)?.chatIds).toEqual(["ses_a", "ses_b"]));
		expect(vcs.links).toEqual([{ directory: COPY, chatId: "ses_a", baseRef: "origin/main" }]);
	});

	it("backfills one chat per copy on the first full read", async () => {
		const core = new FakeCore();
		core.chats = [
			chat("ses_old", { directory: "/wt/a", worktreeBranch: "kilo/a", updatedAt: 1 }),
			chat("ses_new", { directory: "/wt/a", worktreeBranch: "kilo/a", updatedAt: 2 }),
			chat("ses_plain", { directory: "/projects/app" }),
		];
		const vcs = new FakeVcs();
		const booted = await bootWorkSessions({ core, vcs });

		await eventually(() => expect(vcs.links).toEqual([{ directory: "/wt/a", chatId: "ses_new" }]));
		core.setReady(false);
		core.setReady(true);
		core.upsert(chat("ses_other", { directory: "/wt/c", worktreeBranch: "kilo/c", updatedAt: 3 }));
		await eventually(() =>
			expect(booted.list().some((session) => session.directory === "/wt/c")).toBe(true),
		);
		expect(vcs.links).toHaveLength(1);
	});

	it("prefers a live chat over an archived one", () => {
		expect(
			copyChatLinks([
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
