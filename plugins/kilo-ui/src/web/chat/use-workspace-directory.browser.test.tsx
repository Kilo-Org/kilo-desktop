import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as AssistantUiReact from "@assistant-ui/react";

import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import { useThreadWorkingDirectory } from "./use-workspace-directory.js";

const threadListItem = vi.hoisted(() => ({
	remoteId: null as string | null,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		useAuiState: (selector: (state: { threadListItem: typeof threadListItem }) => unknown) =>
			selector({ threadListItem }),
	};
});

vi.mock("../workspaces/WorkspacesFeatureContext.js", () => ({
	useWorkspacesFeature: vi.fn(() => ({
		workspaces: [],
		activeWorkspaceId: null,
	})),
}));

function withStore(children: ReactNode, store: ReturnType<typeof createSessionActivityStore>) {
	return <SessionActivityProvider store={store}>{children}</SessionActivityProvider>;
}

describe("useThreadWorkingDirectory", () => {
	it("returns the worktree directory when the session is worktree-backed", () => {
		threadListItem.remoteId = "ses-worktree";
		const store = createSessionActivityStore({ storage: null });
		store.getState().hydrateSessions([
			{
				id: "ses-worktree",
				directory: "/workspace/project/.kilo/worktrees/kilo-aback-aardvark",
				worktreeBranch: "kilo/aback-aardvark",
			},
		]);

		const { result } = renderHook(() => useThreadWorkingDirectory(), {
			wrapper: ({ children }) => withStore(children, store),
		});

		expect(result.current).toBe("/workspace/project/.kilo/worktrees/kilo-aback-aardvark");
	});

	it("returns undefined when there is no worktree activity and no workspace", () => {
		threadListItem.remoteId = null;
		const store = createSessionActivityStore({ storage: null });

		const { result } = renderHook(() => useThreadWorkingDirectory(), {
			wrapper: ({ children }) => withStore(children, store),
		});

		expect(result.current).toBeUndefined();
	});
});
