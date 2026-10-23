import { describe, expect, it, vi } from "vitest";

import { createSessionActivityStore } from "../session/activity/session-activity-store.js";
import { createWorktreeBranchNamer } from "./worktree-branch-namer.js";

const WORKTREE_DIRECTORY = "/repo/.kilo/worktrees/kilo-aback-aardvark";

/** The kilo-client surface the namer touches, as an injectable double. */
function setup(options?: {
	generatedBranch?: string | null;
	renamedBranch?: { branch: string } | null;
	sessionMetadata?: unknown;
	/** Arm session-1 as a freshly created session (default true). */
	armed?: boolean;
	/** Base ref to arm session-1 with, when `armed` is not `false`. */
	armBaseRef?: string;
	hasWorktreeWork?: (input: { directory: string; baseBranch?: string }) => Promise<boolean>;
}) {
	const store = createSessionActivityStore({ storage: null });
	const generate = vi.fn(async (_input: Record<string, unknown>, _options?: unknown) => ({
		// `??` is deliberately avoided: an explicit `null` (endpoint decline)
		// is authoritative.
		data: {
			branch:
				options?.generatedBranch === undefined ? "fix-the-login-bug" : options.generatedBranch,
		},
	}));
	const sessionGet = vi.fn(async () => ({
		data: {
			id: "session-1",
			directory: WORKTREE_DIRECTORY,
			metadata: {
				...(options?.sessionMetadata === undefined
					? {
							anaconda: {
								workspaceId: "ws-1",
								workspaceFolders: [{ path: "/repo", isPrimary: true }],
								worktree: { branch: "kilo/aback-aardvark" },
							},
						}
					: options.sessionMetadata),
			},
		},
	}));
	const sessionUpdate = vi.fn(async () => ({ data: undefined }));
	const client = {
		branchName: { generate },
		session: { get: sessionGet, update: sessionUpdate },
	};
	// Mirrors the git plugin's guard: declines unless `currentBranch` is
	// still git's actual branch, so a stale caller can never rename.
	let gitBranch = "kilo/aback-aardvark";
	const renameWorktreeBranch = vi.fn(
		async (input: { directory: string; currentBranch: string; requestedBranch: string }) => {
			if (options?.renamedBranch !== undefined) return options.renamedBranch;
			if (input.currentBranch !== gitBranch) return null;
			gitBranch = `kilo/${input.requestedBranch}`;
			return { branch: gitBranch };
		},
	);
	const notify = vi.fn();
	const namer = createWorktreeBranchNamer({
		getConnection: async () => {
			throw new Error("unused — the directory client is injected");
		},
		sessionActivity: store,
		renameWorktreeBranch,
		createDirectoryClient: async () => client as never,
		notify,
		...(options?.hasWorktreeWork ? { hasWorktreeWork: options.hasWorktreeWork } : {}),
	});

	store
		.getState()
		.hydrateSessions([
			{ id: "session-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
		]);
	if (options?.armed !== false) {
		namer.arm("session-1", options?.armBaseRef ? { baseRef: options.armBaseRef } : undefined);
	}

	const setBusy = () =>
		store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "session-1", status: { type: "busy" } },
		});
	const setIdle = () =>
		store.getState().applyEvent({
			type: "session.idle",
			properties: { sessionID: "session-1" },
		});

	/** One full chat turn: send, run, settle. */
	const turn = async (text: string) => {
		namer.prompt({ sessionID: "session-1", text });
		setBusy();
		await settle();
		setIdle();
		await settle();
	};
	const successfulRenames = () =>
		renameWorktreeBranch.mock.settledResults.filter(
			(result) => result.type === "fulfilled" && result.value !== null,
		).length;

	return {
		namer,
		store,
		generate,
		sessionGet,
		sessionUpdate,
		renameWorktreeBranch,
		notify,
		setBusy,
		setIdle,
		turn,
		successfulRenames,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createWorktreeBranchNamer", () => {
	it("arms on the first prompt and dispatches a generation on the second", async () => {
		const s = setup();

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		expect(s.generate).not.toHaveBeenCalled();

		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledWith(
				{
					sessionID: "session-1",
					directory: WORKTREE_DIRECTORY,
					prompt: "fix the login bug",
				},
				expect.anything(),
			);
		});
	});

	it("applies the rename and re-stamps the full kilo-desktop metadata", async () => {
		const s = setup();

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });

		await vi.waitFor(() => {
			expect(s.renameWorktreeBranch).toHaveBeenCalledWith({
				directory: WORKTREE_DIRECTORY,
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "fix-the-login-bug",
			});
		});
		await vi.waitFor(() => {
			expect(s.sessionUpdate).toHaveBeenCalledWith(
				{
					sessionID: "session-1",
					metadata: {
						// The legacy ownership key survives the restamp.
						anaconda: {
							workspaceId: "ws-1",
							workspaceFolders: [{ path: "/repo", isPrimary: true }],
							worktree: { branch: "kilo/aback-aardvark" },
						},
						"kilo-desktop": {
							workspaceId: "ws-1",
							workspaceFolders: [{ path: "/repo", isPrimary: true }],
							worktree: { branch: "kilo/fix-the-login-bug" },
						},
					},
				},
				expect.anything(),
			);
		});
		expect(s.notify).toHaveBeenCalledWith("Branch renamed to kilo/fix-the-login-bug");
		expect(s.store.getState().sessions["session-1"]?.worktreeBranch).toBe("kilo/fix-the-login-bug");
	});

	it("preserves unrelated top-level metadata keys on restamp", async () => {
		const s = setup({
			sessionMetadata: {
				other: "x",
				anaconda: {
					workspaceId: "ws-1",
					workspaceFolders: [{ path: "/repo", isPrimary: true }],
					worktree: { branch: "kilo/aback-aardvark" },
				},
			},
		});

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });

		await vi.waitFor(() => {
			// session.update replaces the metadata object wholesale, so the
			// restamp must spread the existing record — unrelated keys and the
			// legacy `anaconda` ownership key survive the rename.
			expect(s.sessionUpdate).toHaveBeenCalledWith(
				{
					sessionID: "session-1",
					metadata: {
						other: "x",
						anaconda: {
							workspaceId: "ws-1",
							workspaceFolders: [{ path: "/repo", isPrimary: true }],
							worktree: { branch: "kilo/aback-aardvark" },
						},
						"kilo-desktop": {
							workspaceId: "ws-1",
							workspaceFolders: [{ path: "/repo", isPrimary: true }],
							worktree: { branch: "kilo/fix-the-login-bug" },
						},
					},
				},
				expect.anything(),
			);
		});
	});

	it("keeps the session armed when the endpoint declines with null", async () => {
		const s = setup({ generatedBranch: null });

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "hi there" });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(1);
		});
		expect(s.renameWorktreeBranch).not.toHaveBeenCalled();

		// Still armed within the prompt cap: the next prompt dispatches again.
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(2);
		});
	});

	it("stays armed when the rename guards decline", async () => {
		const s = setup({ renamedBranch: null });

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		await vi.waitFor(() => {
			expect(s.renameWorktreeBranch).toHaveBeenCalledTimes(1);
		});
		expect(s.sessionUpdate).not.toHaveBeenCalled();

		s.namer.prompt({ sessionID: "session-1", text: "more detail" });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(2);
		});
	});

	it("defers a busy session's rename to the next idle transition", async () => {
		const s = setup();

		s.setBusy();
		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(1);
		});
		// The name arrived while busy — held, not applied.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.renameWorktreeBranch).not.toHaveBeenCalled();

		s.setIdle();
		await vi.waitFor(() => {
			expect(s.renameWorktreeBranch).toHaveBeenCalledTimes(1);
		});
		await vi.waitFor(() => {
			expect(s.sessionUpdate).toHaveBeenCalled();
		});
	});

	it("dispatches once on the first idle transition after a single prompt", async () => {
		const s = setup();

		s.namer.prompt({ sessionID: "session-1", text: "one very detailed prompt" });
		s.setBusy();
		s.setIdle();
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledWith(
				{ sessionID: "session-1", directory: WORKTREE_DIRECTORY, prompt: "" },
				expect.anything(),
			);
		});

		// Exactly once — further idle transitions never re-dispatch.
		s.setIdle();
		s.setIdle();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.generate).toHaveBeenCalledTimes(1);
	});

	it("disarms when another session shares the worktree directory", async () => {
		const s = setup();
		s.store
			.getState()
			.hydrateSessions([
				{ id: "session-2", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
			]);

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.generate).not.toHaveBeenCalled();
	});

	it("disarms after the prompt cap", async () => {
		const s = setup({ generatedBranch: null });
		const prompt = (text: string) => s.namer.prompt({ sessionID: "session-1", text });

		prompt("prompt 1"); // arms
		prompt("prompt 2"); // dispatches
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(1);
		});
		prompt("prompt 3"); // dispatches (the previous generation settled)
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(2);
		});
		prompt("prompt 4"); // last dispatch within the cap
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(3);
		});

		// The 5th prompt exceeds the cap (kilocode's MAX_PROMPTS = 4):
		// disarm, no further generations.
		prompt("prompt 5");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.generate).toHaveBeenCalledTimes(3);
	});

	it("ignores non-worktree sessions", async () => {
		const s = setup();
		s.store.getState().hydrateSessions([{ id: "session-2", directory: "/repo" }]);
		s.store.getState().applyEvent({
			type: "session.status",
			properties: { sessionID: "session-2", status: { type: "busy" } },
		});

		s.namer.prompt({ sessionID: "session-2", text: "hello" });
		s.namer.prompt({ sessionID: "session-2", text: "world" });
		s.store.getState().applyEvent({
			type: "session.idle",
			properties: { sessionID: "session-2" },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.generate).not.toHaveBeenCalled();
	});

	it("never names a session that was not armed at creation", async () => {
		// A reload (or a recreated namer) must not re-arm existing sessions —
		// their branch may already carry a semantic name.
		const s = setup({ armed: false, hasWorktreeWork: async () => true });

		for (let index = 1; index <= 3; index++) await s.turn(`prompt ${index}`);

		expect(s.generate).not.toHaveBeenCalled();
		expect(s.renameWorktreeBranch).not.toHaveBeenCalled();
	});

	it("renames at most once, even across many turns with work", async () => {
		const s = setup({ hasWorktreeWork: async () => true });
		let generated = 0;
		s.generate.mockImplementation(async () => ({ data: { branch: `name-${++generated}` } }));

		for (let index = 1; index <= 8; index++) await s.turn(`prompt ${index}`);

		expect(s.successfulRenames()).toBe(1);
		expect(s.store.getState().sessions["session-1"]?.worktreeBranch).toBe("kilo/name-1");
	});

	it("stays disarmed after the prompt cap", async () => {
		const s = setup({ generatedBranch: null, hasWorktreeWork: async () => false });

		for (let index = 1; index <= 9; index++) await s.turn(`prompt ${index}`);

		// Prompts 2–4 dispatch; nothing after the cap ever re-arms.
		expect(s.generate).toHaveBeenCalledTimes(3);
	});

	it("ignores subagent child sessions sharing the worktree directory", async () => {
		const s = setup();
		s.store
			.getState()
			.hydrateSessions([{ id: "child-1", parentId: "session-1", directory: WORKTREE_DIRECTORY }]);

		await s.turn("hello");
		await s.turn("fix the login bug");

		expect(s.successfulRenames()).toBe(1);
	});

	it("passes the armed base ref to the idle work probe as baseBranch", async () => {
		const hasWorktreeWork = vi.fn(async () => true);
		const s = setup({ hasWorktreeWork, armBaseRef: "origin/main" });

		await s.turn("one detailed prompt");

		await vi.waitFor(() => {
			expect(hasWorktreeWork).toHaveBeenCalledWith({
				directory: WORKTREE_DIRECTORY,
				baseBranch: "origin/main",
			});
		});
	});

	it("omits baseBranch from the idle work probe when armed without a base ref", async () => {
		const hasWorktreeWork = vi.fn(async () => true);
		const s = setup({ hasWorktreeWork });

		await s.turn("one detailed prompt");

		await vi.waitFor(() => {
			expect(hasWorktreeWork).toHaveBeenCalledWith({ directory: WORKTREE_DIRECTORY });
		});
	});

	it("runs the single-prompt idle path only on a busy → idle transition", async () => {
		const hasWorktreeWork = vi.fn(async () => true);
		const s = setup({ hasWorktreeWork });

		s.namer.prompt({ sessionID: "session-1", text: "one detailed prompt" });
		// Unrelated store churn before the turn goes busy is not an idle transition.
		s.store.getState().hydrateSessions([{ id: "other", directory: "/elsewhere" }]);
		await settle();
		expect(hasWorktreeWork).not.toHaveBeenCalled();

		s.setBusy();
		s.setIdle();
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledTimes(1);
		});
		expect(hasWorktreeWork).toHaveBeenCalledTimes(1);
	});

	it("does not dispatch a second generation while the idle work probe is in flight", async () => {
		let resolveWork!: (hasWork: boolean) => void;
		const s = setup({
			hasWorktreeWork: () => new Promise<boolean>((resolve) => (resolveWork = resolve)),
		});

		s.namer.prompt({ sessionID: "session-1", text: "detailed first prompt" });
		s.setBusy();
		s.setIdle();
		// The probe holds the slot: prompt 2 must not dispatch alongside it.
		s.namer.prompt({ sessionID: "session-1", text: "second prompt" });
		resolveWork(true);

		await vi.waitFor(() => {
			expect(s.successfulRenames()).toBe(1);
		});
		await settle();
		expect(s.generate).toHaveBeenCalledTimes(1);
		expect(s.successfulRenames()).toBe(1);
	});

	it("forwards the prompt's model to the generator, including on the idle path", async () => {
		const s = setup({ generatedBranch: null });
		const model = { providerID: "kilo", modelID: "anthropic/claude" };

		s.namer.prompt({ sessionID: "session-1", text: "hello", ...model });
		s.setBusy();
		s.setIdle();
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenCalledWith(
				{ sessionID: "session-1", directory: WORKTREE_DIRECTORY, prompt: "", ...model },
				expect.anything(),
			);
		});

		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug", ...model });
		await vi.waitFor(() => {
			expect(s.generate).toHaveBeenLastCalledWith(
				{
					sessionID: "session-1",
					directory: WORKTREE_DIRECTORY,
					prompt: "fix the login bug",
					...model,
				},
				expect.anything(),
			);
		});
	});

	it("disarms once git renamed the branch, even when the re-stamp fails", async () => {
		const s = setup({ hasWorktreeWork: async () => true });
		s.sessionUpdate.mockRejectedValue(new Error("server unavailable"));

		for (let index = 1; index <= 5; index++) await s.turn(`prompt ${index}`);

		expect(s.successfulRenames()).toBe(1);
		// The store reflects git's truth even though the server stamp failed.
		expect(s.store.getState().sessions["session-1"]?.worktreeBranch).toBe("kilo/fix-the-login-bug");
	});

	it("dispose aborts in-flight generations and stops observing", async () => {
		const s = setup();

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		s.namer.dispose();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.renameWorktreeBranch).not.toHaveBeenCalled();
	});
});
