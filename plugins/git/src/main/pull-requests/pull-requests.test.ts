import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import type { WorkSession } from "@kilo-desktop/plugin-work-sessions/contracts";

import { PullRequests, type PullRequest, type PullRequestSnapshot } from "../../contracts";
import type { PullRequestSource } from "../shared/pull-request-source";
import {
	bootGitMain,
	stopGitMains,
	workSession as session,
	type MemoryStorage,
} from "../test-boot";
import { activatePullRequests } from ".";

const WAIT = { timeout: 5_000 };

/** `vi.waitFor` without its interval, for tests that fake `setInterval`. */
async function eventually(assertion: () => void): Promise<void> {
	const deadline = Date.now() + WAIT.timeout;
	for (;;) {
		try {
			assertion();
			return;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
}

afterEach(async () => {
	vi.useRealTimers();
	await stopGitMains();
});

const PULL_REQUEST: PullRequest = {
	number: 12,
	url: "https://github.com/acme/app/pull/12",
	title: "Fix login",
	baseBranch: "main",
	headBranch: "kilo/fix",
	state: "open",
	isDraft: false,
};

function snapshot(patch: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
	return {
		identity: "kilo/fix|abc",
		branch: "kilo/fix",
		repository: "acme/app",
		parentRepository: null,
		pullRequest: PULL_REQUEST,
		githubStatus: "ready",
		...patch,
	};
}

/** `gh` lookups answered from a table, recorded. */
class FakeLookups implements PullRequestSource {
	readonly answers = new Map<string, PullRequestSnapshot>();
	readonly single: string[] = [];
	readonly batches: string[][] = [];
	failBatch = false;

	async snapshot(directory: string) {
		this.single.push(directory);
		const answer = this.answers.get(directory);
		if (!answer) throw new Error("gh failed");
		return answer;
	}
	async snapshots(directories: readonly string[]) {
		this.batches.push([...directories]);
		if (this.failBatch) throw new Error("graphql failed");
		return directories.map((directory) => ({
			directory,
			snapshot: this.answers.get(directory) ?? null,
		}));
	}
}

async function boot(
	options: {
		sessions?: WorkSession[];
		lookups?: FakeLookups;
		storage?: MemoryStorage;
		withoutWorkSessions?: boolean;
	} = {},
) {
	const lookups = options.lookups ?? new FakeLookups();
	const host = await bootGitMain({
		entry: definePlugin({
			activate: (sdk) => void activatePullRequests(sdk, { source: lookups }),
		}),
		core: null,
		workSessions: options.withoutWorkSessions ? null : { workSessions: options.sessions ?? [] },
		...(options.storage ? { storage: options.storage } : {}),
	});
	const pullRequests = host.kernel.kernelSdk.domainObjects.get(PullRequests)!;
	return {
		kernel: host.kernel,
		lookups,
		storage: host.storage,
		pullRequests,
		state: () => pullRequests.getState(),
		setSessions: (list: WorkSession[]) => host.workSessions!.setWorkSessions(list),
	};
}

const SESSIONS = [
	session("local"),
	session("worktree", { branch: "kilo/fix", directory: "/app/.kilo/worktrees/fix" }),
	session("shares-checkout"),
	session("unscoped", { workspaceId: null, directory: "/chats/x" }),
];

describe("kilo.git/pull-requests", () => {
	it("looks every session directory up in one batch once a window is visible", async () => {
		const lookups = new FakeLookups();
		lookups.answers.set("/app/.kilo/worktrees/fix", snapshot());
		const host = await boot({ sessions: SESSIONS, lookups });
		expect(lookups.batches).toEqual([]);

		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });

		await vi.waitFor(
			() =>
				expect(host.state().byDirectory["/app/.kilo/worktrees/fix"]?.snapshot.pullRequest).toEqual(
					PULL_REQUEST,
				),
			WAIT,
		);
		expect(lookups.batches[0]).toEqual(["/app", "/app/.kilo/worktrees/fix"]);
		expect(host.state().githubStatus?.status).toBe("ready");
	});

	it("falls back to single lookups for directories the batch left unanswered", async () => {
		const lookups = new FakeLookups();
		lookups.failBatch = true;
		lookups.answers.set("/app", snapshot({ branch: "main", pullRequest: null }));
		const host = await boot({ sessions: [session("local")], lookups });

		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });

		await vi.waitFor(() => expect(host.state().byDirectory["/app"]).toBeDefined(), WAIT);
		expect(lookups.single).toEqual(["/app"]);
	});

	it("keeps the last snapshot while the GitHub CLI is unusable", async () => {
		const lookups = new FakeLookups();
		lookups.answers.set("/app", snapshot());
		const host = await boot({ sessions: [session("local")], lookups });
		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });
		await vi.waitFor(() => expect(host.state().byDirectory["/app"]).toBeDefined(), WAIT);

		lookups.answers.set("/app", snapshot({ pullRequest: null, githubStatus: "unauthenticated" }));
		await host.pullRequests.methods.refresh({ directory: "/app" });

		await vi.waitFor(() => expect(host.state().githubStatus?.status).toBe("unauthenticated"), WAIT);
		expect(host.state().byDirectory["/app"]?.snapshot.pullRequest).toEqual(PULL_REQUEST);
	});

	it("polls the directories a visible window shows every 15 seconds", async () => {
		const lookups = new FakeLookups();
		lookups.answers.set("/app", snapshot({ branch: "main", pullRequest: null }));
		lookups.answers.set("/app/.kilo/worktrees/fix", snapshot());
		const host = await boot({ sessions: SESSIONS, lookups });
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		await host.pullRequests.methods.setActive({
			windowId: "main",
			directories: ["/app/.kilo/worktrees/fix"],
			visible: true,
		});
		await eventually(() => expect(host.state().byDirectory["/app"]).toBeDefined());
		await new Promise((resolve) => setTimeout(resolve, 20));

		vi.advanceTimersByTime(15_000);

		await eventually(() => expect(lookups.batches.at(-1)).toEqual(["/app/.kilo/worktrees/fix"]));
	});

	it("pauses while no window is visible", async () => {
		const host = await boot({ sessions: [session("local")] });
		await host.pullRequests.methods.setActive({
			windowId: "main",
			directories: [],
			visible: false,
		});
		await host.pullRequests.methods.refresh({ directory: "/elsewhere" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(host.lookups.batches).toEqual([]);

		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });
		await vi.waitFor(() => expect(host.lookups.batches).toHaveLength(1), WAIT);
	});

	it("shows a pull request just created, then drops directories no session uses", async () => {
		const storage = createMemoryStorage();
		const host = await boot({ sessions: SESSIONS, storage });

		await host.pullRequests.methods.recordCreated({
			directory: "/app",
			branch: "feature",
			pullRequest: PULL_REQUEST,
		});

		expect(host.state().byDirectory["/app"]).toMatchObject({
			snapshot: { branch: "feature", pullRequest: PULL_REQUEST, githubStatus: "ready" },
			createdAt: expect.any(Number),
		});
		expect(JSON.stringify(storage.saved.get("pull-requests"))).toContain("feature");

		host.setSessions([session("worktree", { directory: "/app/.kilo/worktrees/fix" })]);
		await vi.waitFor(() => expect(host.state().byDirectory["/app"]).toBeUndefined(), WAIT);
	});

	it("restores saved snapshots younger than a day", async () => {
		const storage = createMemoryStorage();
		storage.saved.set("pull-requests", {
			byDirectory: {
				"/app": { snapshot: snapshot(), updatedAt: Date.now() - 1_000 },
				"/old": { snapshot: snapshot(), updatedAt: Date.now() - 25 * 60 * 60_000 },
				"/broken": { updatedAt: Date.now() },
			},
		});

		const host = await boot({ storage });

		expect(Object.keys(host.state().byDirectory)).toEqual(["/app"]);
	});

	it("drops a closed window's report, pausing until a window is visible again", async () => {
		const lookups = new FakeLookups();
		lookups.answers.set("/app", snapshot({ branch: "main", pullRequest: null }));
		const host = await boot({ sessions: [session("local")], lookups });
		host.kernel.windowEvents.opened("main", { role: "main" });
		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });
		await vi.waitFor(() => expect(lookups.batches).toHaveLength(1), WAIT);

		host.kernel.windowEvents.closed("main");
		await host.pullRequests.methods.setActive({
			windowId: "other",
			directories: [],
			visible: false,
		});
		await host.pullRequests.methods.setActive({
			windowId: "other",
			directories: [],
			visible: true,
		});

		await vi.waitFor(() => expect(lookups.batches).toHaveLength(2), WAIT);
	});

	it("looks a directory up again after 2 and 8 seconds when asked to settle", async () => {
		const lookups = new FakeLookups();
		lookups.answers.set("/app", snapshot());
		const host = await boot({ sessions: [session("local")], lookups });
		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });
		await vi.waitFor(() => expect(host.state().byDirectory["/app"]).toBeDefined(), WAIT);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		await host.pullRequests.methods.refresh({ directory: "/app", settle: true });
		await vi.advanceTimersByTimeAsync(8_000);

		expect(lookups.single).toEqual(["/app", "/app", "/app"]);
	});

	it("works without kilo.work-sessions, looking nothing up", async () => {
		const host = await boot({ withoutWorkSessions: true });

		await host.pullRequests.methods.setActive({ windowId: "main", directories: [], visible: true });
		await host.pullRequests.methods.refresh({ directory: "/app" });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(host.lookups.batches).toEqual([]);
		expect(host.lookups.single).toEqual([]);
		expect(host.state().byDirectory).toEqual({});
	});
});
