import { describe, expect, it, vi } from "vitest";

import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import { createWorktreeBranchNamer } from "./worktree-branch-namer.js";

const WORKTREE_DIRECTORY = "/repo/.kilo/worktrees/kilo-aback-aardvark";

/** The kilo-client surface the namer touches, as an injectable double. */
function setup(options?: {
	generatedBranch?: string | null;
	renamedBranch?: { branch: string } | null;
	sessionMetadata?: unknown;
}) {
	const store = createSessionActivityStore({ storage: null });
	const generate = vi.fn(async () => ({
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
	const renameWorktreeBranch = vi.fn(async () =>
		options?.renamedBranch === undefined
			? { branch: "kilo/fix-the-login-bug" }
			: options.renamedBranch,
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
	});

	store
		.getState()
		.hydrateSessions([
			{ id: "session-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
		]);

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
	};
}

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

	it("dispose aborts in-flight generations and stops observing", async () => {
		const s = setup();

		s.namer.prompt({ sessionID: "session-1", text: "hello" });
		s.namer.prompt({ sessionID: "session-1", text: "fix the login bug" });
		s.namer.dispose();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(s.renameWorktreeBranch).not.toHaveBeenCalled();
	});
});
