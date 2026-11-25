import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import { createGitClient } from "@kilo-desktop/git-client";
import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import type { VcsImplementation, WorkSession } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	bootGitMain,
	chat,
	recordingLogger,
	stopGitMains,
	workSession,
	type MemoryStorage,
} from "../test-boot";
import { activateBranchNamer } from ".";

const WAIT = { timeout: 15_000 };
const directories: string[] = [];

afterEach(async () => {
	await stopGitMains();
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

const nothingDone = () => new Promise((resolve) => setTimeout(resolve, 100));

type NamerVcs = Pick<VcsImplementation, "renameCopyBranch" | "hasCopyWork" | "isManagedBranch">;

/**
 * The slice of `kilo.work-sessions/vcs` the namer uses, over real git: a
 * managed branch is `kilo/…`; a rename declines unless the copy is still on
 * `currentBranch`, and keeps `kilo/`. (kilo.git's own guard chain is the
 * repository area's to test.)
 */
function gitVcs(): NamerVcs & { readonly renames: { directory: string; branch: string }[] } {
	const git = createGitClient();
	const renames: { directory: string; branch: string }[] = [];
	return {
		renames,
		isManagedBranch: (branch) => branch.startsWith("kilo/"),
		async renameCopyBranch({ directory, currentBranch: expected, requestedBranch }) {
			if (currentBranch(directory) !== expected) return null;
			const branch = `kilo/${requestedBranch}`;
			await git.renameBranch(expected, branch, { cwd: directory });
			renames.push({ directory, branch });
			return { branch };
		},
		async hasCopyWork({ directory, baseBranch }) {
			const status = await git.status({ cwd: directory });
			if ((status?.workingDirectory.files.length ?? 0) > 0) return true;
			if (!baseBranch) return false;
			const { stdout } = await git.exec(
				["rev-list", "--count", `${baseBranch}..HEAD`],
				"rev-list",
				{ cwd: directory },
			);
			return Number(stdout.trim()) > 0;
		},
	};
}

async function createCopy(repoDir: string): Promise<{ directory: string; branch: string }> {
	const directory = path.join(repoDir, ".kilo", "worktrees", "kilo-aback-aardvark");
	const branch = "kilo/aback-aardvark";
	await createGitClient({ path: repoDir }).addWorktree(directory, { createBranch: branch });
	return { directory, branch };
}

async function boot(options: {
	workSessions?: WorkSession[];
	chats?: ChatSummary[];
	storage?: MemoryStorage;
	names?: (string | null)[];
}) {
	const vcs = gitVcs();
	const host = await bootGitMain({
		entry: definePlugin({ activate: (sdk) => activateBranchNamer(sdk, { vcs }) }),
		core: { chats: options.chats ?? [], names: options.names ?? [] },
		workSessions: { workSessions: options.workSessions ?? [] },
		...(options.storage ? { storage: options.storage } : {}),
	});
	const core = host.core!;
	const workSessions = host.workSessions!;
	return {
		kernel: host.kernel,
		storage: host.storage,
		vcs,
		core,
		workSessions,
		/** The chat joins its work session, as kilo.work-sessions reports it. */
		join(workSessionId: string, chatId: string, directory: string) {
			core.upsert(chat(chatId, directory));
			workSessions.join(workSessionId, chatId);
		},
		send: (chatId: string, text: string) => core.send(chatId, text),
		/** One turn of the chat, started by `text` unless the agent carries on by itself. */
		async turn(chatId: string, text?: string, during?: () => void) {
			if (text !== undefined) core.send(chatId, text);
			core.setStatus(chatId, "busy");
			core.turnStarted(chatId);
			await new Promise((resolve) => setTimeout(resolve, 10));
			during?.();
			core.setStatus(chatId, "idle");
			core.turnEnded(chatId);
		},
	};
}

describe("the copy branch namer", () => {
	it("renames a new copy's branch on the second prompt and records it on the work session", async () => {
		const repoDir = initRepo();
		const copy = await createCopy(repoDir);
		const host = await boot({
			workSessions: [
				workSession("wses_1", {
					copyCreated: true,
					directory: copy.directory,
					branch: copy.branch,
				}),
			],
		});
		host.join("wses_1", "ses_1", copy.directory);

		host.send("ses_1", "hello");
		await nothingDone();
		expect(host.core.generated).toEqual([]);
		host.send("ses_1", "fix the login bug");

		await vi.waitFor(() => expect(host.workSessions.branches).toHaveLength(1), WAIT);
		expect(host.core.generated).toEqual([{ chatId: "ses_1", prompt: "fix the login bug" }]);
		expect(currentBranch(copy.directory)).toBe("kilo/fix-the-login-bug");
		expect(host.workSessions.branches).toEqual([
			{ id: "wses_1", branch: "kilo/fix-the-login-bug" },
		]);
		expect(host.vcs.renames).toEqual([
			{ directory: copy.directory, branch: "kilo/fix-the-login-bug" },
		]);
		expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} });
	});

	it("names from a single prompt once its turn ends with work in the copy", async () => {
		const repoDir = initRepo();
		const copy = await createCopy(repoDir);
		const host = await boot({
			workSessions: [
				workSession("wses_1", {
					copyCreated: true,
					directory: copy.directory,
					branch: copy.branch,
				}),
			],
		});
		host.join("wses_1", "ses_1", copy.directory);

		await host.turn("ses_1", "build the login page");
		await nothingDone();
		expect(host.core.generated).toEqual([]);

		await host.turn("ses_1", undefined, () =>
			fs.writeFileSync(path.join(copy.directory, "login.ts"), "export {};\n"),
		);
		await vi.waitFor(() => expect(host.workSessions.branches).toHaveLength(1), WAIT);

		expect(host.core.generated).toEqual([{ chatId: "ses_1", prompt: "" }]);
		expect(currentBranch(copy.directory)).toBe("kilo/fix-the-login-bug");
	});

	it("leaves branches alone outside kilo/, in shared directories and in picked copies", async () => {
		const repoDir = initRepo();
		const shared = `${repoDir}/.kilo/worktrees/shared`;
		const host = await boot({
			workSessions: [
				workSession("wses_feature", {
					copyCreated: true,
					directory: `${repoDir}/.kilo/worktrees/feature`,
					branch: "feature",
				}),
				workSession("wses_shared", { copyCreated: true, directory: shared, branch: "kilo/shared" }),
				workSession("wses_other", { directory: shared, branch: "kilo/shared" }),
				workSession("wses_picked", {
					directory: `${repoDir}/.kilo/worktrees/picked`,
					branch: "kilo/picked",
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

		expect(host.core.generated).toEqual([]);
		expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} });
	});

	it("keeps its progress across a restart and never renames twice", async () => {
		const repoDir = initRepo();
		const copy = await createCopy(repoDir);
		const storage = createMemoryStorage();
		const placed = workSession("wses_1", {
			copyCreated: true,
			directory: copy.directory,
			branch: copy.branch,
		});
		const first = await boot({ workSessions: [placed], storage });
		first.join("wses_1", "ses_1", copy.directory);
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
		const chats = [chat("ses_1", copy.directory)];
		const second = await boot({ workSessions: [linked], chats, storage });
		second.send("ses_1", "fix the login bug");
		await vi.waitFor(() => expect(second.workSessions.branches).toHaveLength(1), WAIT);
		await second.turn("ses_1", "and the logout");
		await second.kernel.stop();

		const renamed = { ...linked, branch: "kilo/fix-the-login-bug" };
		const third = await boot({
			workSessions: [renamed],
			chats,
			storage,
			names: ["something-else"],
		});
		await third.turn("ses_1", "one more");
		await third.turn("ses_1", "and another");
		await nothingDone();

		expect(third.core.generated).toEqual([]);
		expect(currentBranch(copy.directory)).toBe("kilo/fix-the-login-bug");
	});

	it("reads progress origin saved, with its model", async () => {
		const repoDir = initRepo();
		const copy = await createCopy(repoDir);
		const storage = createMemoryStorage();
		storage.saved.set("branch-namer", {
			armed: {
				ses_1: {
					promptCount: 1,
					idleAttempted: false,
					model: { providerID: "kilo", modelID: "anthropic/claude" },
				},
				broken: { idleAttempted: true },
			},
		});
		const host = await boot({
			workSessions: [
				workSession("wses_1", {
					copyCreated: true,
					directory: copy.directory,
					branch: copy.branch,
					chatIds: ["ses_1"],
				}),
			],
			chats: [chat("ses_1", copy.directory)],
			storage,
			names: [null],
		});

		await host.turn("ses_1", undefined, () =>
			fs.writeFileSync(path.join(copy.directory, "login.ts"), "export {};\n"),
		);

		await vi.waitFor(
			() =>
				expect(host.core.generated).toEqual([
					{
						chatId: "ses_1",
						prompt: "",
						model: { aiProviderId: "kilo", modelId: "anthropic/claude" },
					},
				]),
			WAIT,
		);
	});

	it("forgets the chats of a deleted work session", async () => {
		const repoDir = initRepo();
		const directory = `${repoDir}/.kilo/worktrees/gone`;
		const host = await boot({
			workSessions: [workSession("wses_1", { copyCreated: true, directory, branch: "kilo/x" })],
		});
		host.join("wses_1", "ses_1", directory);
		await vi.waitFor(
			() =>
				expect(Object.keys(host.storage.saved.get("branch-namer")?.armed ?? {})).toEqual(["ses_1"]),
			WAIT,
		);

		host.workSessions.remove("wses_1");

		await vi.waitFor(
			() => expect(host.storage.saved.get("branch-namer")).toEqual({ armed: {} }),
			WAIT,
		);
	});

	it("forgets saved chats a full read shows the server no longer has", async () => {
		const storage = createMemoryStorage();
		storage.saved.set("branch-namer", {
			armed: {
				ses_v1: { promptCount: 1, idleAttempted: false },
				ses_subagent: { promptCount: 1, idleAttempted: false },
				ses_live: { promptCount: 1, idleAttempted: false },
			},
		});
		const host = await boot({ chats: [chat("ses_live", "/projects/app")], storage });
		host.core.onServer.add("ses_subagent");

		host.core.vanishAndList("ses_none");

		await vi.waitFor(
			() =>
				expect(Object.keys(host.storage.saved.get("branch-namer")?.armed ?? {}).sort()).toEqual([
					"ses_live",
					"ses_subagent",
				]),
			WAIT,
		);
	});

	it("activates quietly without kilo.core and kilo.work-sessions", async () => {
		const { logger, warnings, errors } = recordingLogger();

		await bootGitMain({
			entry: definePlugin({ activate: (sdk) => activateBranchNamer(sdk, { vcs: gitVcs() }) }),
			core: null,
			workSessions: null,
			logger,
		});

		// The kernel reports kilo.git's manifest contributions to absent plugins; the namer says nothing.
		const own = warnings.filter(
			([message]) => !String(message).startsWith("[kilo.git] Contribution"),
		);
		expect(own).toEqual([]);
		expect(errors).toEqual([]);
	});
});
