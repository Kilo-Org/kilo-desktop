import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	DEFAULT_WORKSPACE_BOARD,
	placeSession,
	type WorkspaceBoardState,
} from "../../../contracts/workspace-board/board-model.js";
import { workspaceBoardContract } from "../../../contracts/workspace-board/schemas.js";
import { useWorkspaceBoardStore } from "./use-workspace-board-store.js";

afterEach(cleanup);

it("keeps a later placement on screen when an earlier save responds first", async () => {
	let stored: WorkspaceBoardState = DEFAULT_WORKSPACE_BOARD;
	const pending: (() => void)[] = [];
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspaceBoardContract,
		handlers: {
			"workspaceBoard.get": async () => stored,
			"workspaceBoard.place": ({
				sessionId,
				columnId,
				index,
			}: {
				sessionId: string;
				columnId: string;
				index: number;
			}) =>
				new Promise<WorkspaceBoardState>((resolve) => {
					stored = placeSession(stored, sessionId, columnId, index);
					const saved = stored;
					pending.push(() => resolve(saved));
				}),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<SdkProvider system={system}>{children}</SdkProvider>
		</QueryClientProvider>
	);
	const { result } = renderHook(() => useWorkspaceBoardStore(true), { wrapper });
	await waitFor(() =>
		expect(queryClient.getQueryData(["kilo-ui", "workspace-board"])).toBeDefined(),
	);

	const doneIds = () =>
		result.current.board.columns.find((column) => column.id === "done")?.sessionIds;
	act(() => result.current.place("ses_a", "done", 0));
	act(() => result.current.place("ses_b", "done", 1));
	await waitFor(() => expect(doneIds()).toEqual(["ses_a", "ses_b"]));
	await waitFor(() => expect(pending).toHaveLength(2));

	// The first save's response only knows about ses_a; ses_b is still being saved.
	await act(async () => {
		pending[0]!();
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	expect(doneIds()).toEqual(["ses_a", "ses_b"]);

	await act(async () => pending[1]!());
	await waitFor(() => expect(doneIds()).toEqual(["ses_a", "ses_b"]));
});

it("refetches the board when another window changes it", async () => {
	let stored: WorkspaceBoardState = DEFAULT_WORKSPACE_BOARD;
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspaceBoardContract,
		handlers: { "workspaceBoard.get": async () => stored },
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<SdkProvider system={system}>{children}</SdkProvider>
		</QueryClientProvider>
	);
	const { result } = renderHook(() => useWorkspaceBoardStore(true), { wrapper });
	await waitFor(() => expect(result.current.board).toEqual(DEFAULT_WORKSPACE_BOARD));

	stored = placeSession(stored, "ses_other_window", "review", 0);
	act(() => sdk.events.emit("workspace-board-changed", undefined));

	await waitFor(() =>
		expect(
			result.current.board.columns.find((column) => column.id === "review")?.sessionIds,
		).toEqual(["ses_other_window"]),
	);
});
