import { vi } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import {
	DEFAULT_WORKSPACE_BOARD,
	type WorkspaceBoardState,
} from "../../../contracts/workspace-board/board-model.js";
import type { WorkspaceBoardService } from "../../../contracts/workspace-board/schemas.js";
import { registerWorkspaceBoard } from "../../../main/workspace-board/register.js";
import { WORKSPACE_BOARD_FEATURE_FLAG } from "./workspace-board-constants.js";

type BoardMethod = keyof WorkspaceBoardService;

/**
 * Renderer-test handlers backed by the real main-process board (validation,
 * errors and all) over an in-memory store. Each handler is a spy.
 */
export function createWorkspaceBoardBackend(
	initial: WorkspaceBoardState = DEFAULT_WORKSPACE_BOARD,
) {
	let snapshot = { version: 1, state: initial };
	let failWrites = false;
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui" });
	registerWorkspaceBoard(mainSdk, {
		snapshot: () => snapshot,
		set: (value) => {
			if (failWrites) throw new Error("Disk unavailable");
			snapshot = value;
		},
	});
	const forward = <M extends BoardMethod>(method: M) =>
		vi.fn((input: Parameters<WorkspaceBoardService[M]>[0]) =>
			mainSdk.invoke(method, input),
		) as unknown as WorkspaceBoardService[M] & ReturnType<typeof vi.fn>;
	const handlers = {
		"workspaceBoard.get": forward("workspaceBoard.get"),
		"workspaceBoard.place": forward("workspaceBoard.place"),
		"workspaceBoard.remove": forward("workspaceBoard.remove"),
		"workspaceBoard.clear": forward("workspaceBoard.clear"),
		"workspaceBoard.addColumn": forward("workspaceBoard.addColumn"),
		"workspaceBoard.renameColumn": forward("workspaceBoard.renameColumn"),
		"workspaceBoard.moveColumn": forward("workspaceBoard.moveColumn"),
		"workspaceBoard.deleteColumn": forward("workspaceBoard.deleteColumn"),
	};
	return {
		handlers,
		stored: () => snapshot.state,
		failWrites: () => {
			failWrites = true;
		},
		dispose: () => mainSdk.dispose(),
	};
}

/** Feature-flag delegate with the board flag set as given. */
export function workspaceBoardFlags(enabled: boolean) {
	const flags = { [WORKSPACE_BOARD_FEATURE_FLAG]: enabled };
	return {
		peek: () => flags,
		subscribe: (listener: (value: typeof flags) => void) => {
			listener(flags);
			return () => undefined;
		},
	};
}
