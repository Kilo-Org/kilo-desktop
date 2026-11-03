import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin, type DomainProvider } from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	Sessions,
	SESSIONS_DEFINITIONS,
	type Session,
} from "@kilo-desktop/plugin-sessions/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { Workspaces, WORKSPACES_DEFINITIONS } from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../../plugin.json";
import {
	GIT_DEFINITIONS,
	PullRequests,
	type PullRequest,
	type PullRequestSnapshot,
} from "../../contracts/index.js";
import { createGitMainEntry } from "../entry.js";
import type { PullRequestSource } from "./index.js";

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
const kernels: MainKernel[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
});

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
		sessions?: Session[];
		lookups?: FakeLookups;
		storage?: ReturnType<typeof createMemoryStorage>;
	} = {},
) {
	const lookups = options.lookups ?? new FakeLookups();
	const storage = options.storage ?? createMemoryStorage();
	let sessions!: DomainProvider<typeof Sessions>;
	const unused = () => {
		throw new Error("unused");
	};
	const kernel = createMainKernel({
		host: createTestHost(),
		hostServices: () => ({ storage }),
		registrations: [
			{
				manifest: workspacesManifest,
				definitions: WORKSPACES_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						sdk.domains.provide(Workspaces, {
							initialState: {
								workspaces: [
									{
										id: "w1",
										name: "App",
										folders: [{ id: "f1", path: "/app", isPrimary: true, position: 0 }],
										createdAt: 0,
										updatedAt: 0,
									},
								],
								activeId: "w1",
								unavailableFolderIds: [],
							},
							methods: {
								create: unused,
								update: unused,
								remove: unused,
								setActive: unused,
								authorize: () => ({ allowed: true }),
								checkFolders: unused,
							},
						});
					},
				}),
			},
			{
				manifest: sessionsManifest,
				definitions: SESSIONS_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						sessions = sdk.domains.provide(Sessions, {
							initialState: { sessions: options.sessions ?? [] },
							methods: {
								create: unused,
								rename: unused,
								setPinned: unused,
								setArchived: unused,
								setWorktreeBranch: unused,
								remove: unused,
								importLegacyPins: unused,
								isolationOptions: () => null,
							},
						});
					},
				}),
			},
			{
				manifest,
				definitions: GIT_DEFINITIONS,
				entry: createGitMainEntry({ pullRequestSource: lookups }),
			},
		],
	});
	kernels.push(kernel);
	await kernel.start();
	const pullRequests = kernel.kernelSdk.domains.get(PullRequests)!;
	return {
		kernel,
		lookups,
		storage,
		pullRequests,
		state: () => pullRequests.getState(),
		setSessions: (list: Session[]) => sessions.setState({ sessions: list }),
	};
}

const SESSIONS = [
	session("local"),
	session("worktree", { worktreeBranch: "kilo/fix", directory: "/app/.kilo/worktrees/fix" }),
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
});
