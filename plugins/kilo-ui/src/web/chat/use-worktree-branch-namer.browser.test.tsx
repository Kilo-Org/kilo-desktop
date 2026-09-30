import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import { useWorktreeBranchNamer } from "./use-worktree-branch-namer.js";
import type { WorktreeBranchNamerDeps } from "./worktree-branch-namer.js";

const WORKTREE_DIRECTORY = "/repo/.kilo/worktrees/kilo-aback-aardvark";

function hydrateArmedSession(store: ReturnType<typeof createSessionActivityStore>) {
	store
		.getState()
		.hydrateSessions([
			{ id: "s1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
		]);
}

/** A minimal directory-client double: generate + rename + restamp surfaces. */
function directoryClientDouble(overrides?: {
	generate?: (input: unknown, options: { signal: AbortSignal }) => Promise<{ data: unknown }>;
}) {
	const generate = vi.fn(
		overrides?.generate ?? (async () => ({ data: { branch: "fix-the-login-bug" } })),
	);
	const sessionGet = vi.fn(async () => ({
		data: { id: "s1", directory: WORKTREE_DIRECTORY, metadata: {} },
	}));
	const sessionUpdate = vi.fn(async () => ({ data: undefined }));
	return {
		generate,
		sessionGet,
		sessionUpdate,
		client: {
			branchName: { generate },
			session: { get: sessionGet, update: sessionUpdate },
		},
	};
}

function baseDeps(
	sessionActivity: ReturnType<typeof createSessionActivityStore>,
	overrides: Partial<WorktreeBranchNamerDeps> = {},
): WorktreeBranchNamerDeps {
	return {
		getConnection: () => {
			throw new Error("unused — the directory client is injected");
		},
		sessionActivity,
		renameWorktreeBranch: vi.fn(async (input: { requestedBranch: string }) => ({
			branch: `kilo/${input.requestedBranch}`,
		})),
		...overrides,
	};
}

describe("useWorktreeBranchNamer", () => {
	it("survives StrictMode's mount-cleanup-mount replay and still generates on the second prompt", async () => {
		const sessionActivity = createSessionActivityStore({ storage: null });
		hydrateArmedSession(sessionActivity);
		const { generate, client } = directoryClientDouble();
		const deps = baseDeps(sessionActivity, {
			createDirectoryClient: async () => client as never,
		});

		const { result } = renderHook(() => useWorktreeBranchNamer(deps), { wrapper: StrictMode });

		result.current.arm("s1");
		result.current.prompt({ sessionID: "s1", text: "hello" });
		result.current.prompt({ sessionID: "s1", text: "fix the login bug in detail" });

		await vi.waitFor(() => {
			expect(generate).toHaveBeenCalledTimes(1);
		});
	});

	it("aborts an in-flight generation when the hook unmounts", async () => {
		const sessionActivity = createSessionActivityStore({ storage: null });
		hydrateArmedSession(sessionActivity);
		let capturedSignal: AbortSignal | undefined;
		const { client } = directoryClientDouble({
			generate: (_input, options) => {
				capturedSignal = options.signal;
				return new Promise(() => {
					// Never resolves — the test asserts the signal, not the result.
				});
			},
		});
		const deps = baseDeps(sessionActivity, {
			createDirectoryClient: async () => client as never,
		});

		const { result, unmount } = renderHook(() => useWorktreeBranchNamer(deps), {
			wrapper: StrictMode,
		});

		result.current.arm("s1");
		result.current.prompt({ sessionID: "s1", text: "hello" });
		result.current.prompt({ sessionID: "s1", text: "fix the login bug in detail" });

		await vi.waitFor(() => {
			expect(capturedSignal).toBeDefined();
		});
		expect(capturedSignal?.aborted).toBe(false);

		unmount();

		expect(capturedSignal?.aborted).toBe(true);
	});

	it("keeps arming across a rerender with a new inline deps object, and calls the new notify", async () => {
		const sessionActivity = createSessionActivityStore({ storage: null });
		hydrateArmedSession(sessionActivity);
		const notifyFirst = vi.fn();
		const notifySecond = vi.fn();
		const { client } = directoryClientDouble();

		const { result, rerender } = renderHook(
			({ notify }: { notify: (message: string) => void }) =>
				useWorktreeBranchNamer(
					baseDeps(sessionActivity, {
						createDirectoryClient: async () => client as never,
						notify,
					}),
				),
			{ wrapper: StrictMode, initialProps: { notify: notifyFirst } },
		);

		result.current.arm("s1");
		result.current.prompt({ sessionID: "s1", text: "hello" });

		rerender({ notify: notifySecond });

		result.current.prompt({ sessionID: "s1", text: "fix the login bug in detail" });

		await vi.waitFor(() => {
			expect(notifySecond).toHaveBeenCalledWith(expect.stringContaining("Branch renamed to"));
		});
		expect(notifyFirst).not.toHaveBeenCalled();
	});
});
