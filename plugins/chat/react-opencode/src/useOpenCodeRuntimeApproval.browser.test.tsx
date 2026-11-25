import type * as AssistantUiReact from "@assistant-ui/react";
import type * as ThreadControllerModule from "./OpenCodeThreadController";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RespondToToolApprovalOptions } from "@assistant-ui/react";

const mocks = vi.hoisted(() => ({
	adapters: [] as unknown[],
	controller: {
		load: vi.fn().mockResolvedValue(undefined),
		replyToPermission: vi.fn().mockResolvedValue(undefined),
	},
	state: undefined as unknown,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
	...(await importOriginal<typeof AssistantUiReact>()),
	useAuiState: () => "session-1",
	useExternalStoreRuntime: (adapter: unknown) => {
		mocks.adapters.push(adapter);
		return {};
	},
	useRemoteThreadListRuntime: (options: { runtimeHook: () => unknown }) => options.runtimeHook(),
}));

vi.mock("./OpenCodeThreadController", async (importOriginal) => {
	const original = await importOriginal<typeof ThreadControllerModule>();

	class OpenCodeThreadController {
		getState = () => mocks.state;
		subscribe = () => () => {};
		load = mocks.controller.load;
		refresh = vi.fn().mockResolvedValue(undefined);
		sendMessage = vi.fn().mockResolvedValue(undefined);
		stageMessage = vi.fn().mockResolvedValue(undefined);
		sendStagedMessage = vi.fn().mockResolvedValue(false);
		cancel = vi.fn().mockResolvedValue(undefined);
		revert = vi.fn().mockResolvedValue(undefined);
		unrevert = vi.fn().mockResolvedValue(undefined);
		fork = vi.fn().mockResolvedValue("");
		replyToPermission = mocks.controller.replyToPermission;
		replyToQuestion = vi.fn().mockResolvedValue(undefined);
		rejectQuestion = vi.fn().mockResolvedValue(undefined);
		dispose = vi.fn();
		// Desktop's fork asks whether a released controller still follows events.
		isAttachedToEvents = () => false;
	}

	return { ...original, OpenCodeThreadController };
});

import { createOpenCodeThreadState } from "./openCodeThreadState";
import type { OpenCodeClient, OpenCodeRuntimeBackend } from "./types";
import { useOpenCodeRuntime } from "./useOpenCodeRuntime";

type ApprovalAdapter = {
	onRespondToToolApproval?: (response: RespondToToolApprovalOptions) => Promise<void> | void;
};

const backend: OpenCodeRuntimeBackend = {
	client: {} as OpenCodeClient,
	initializeSession: async () => ({ id: "session-1" }),
	createEventSource: () => ({ subscribe: () => () => {}, dispose: () => {} }),
};

let root: Root | undefined;

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	mocks.adapters.length = 0;
	vi.clearAllMocks();
});

describe("useOpenCodeRuntime tool approvals", () => {
	it("replies to standard approvals through the OpenCode permission API", async () => {
		mocks.state = createOpenCodeThreadState("session-1");

		const App = () => {
			useOpenCodeRuntime({ backend });
			return null;
		};

		root = createRoot(document.createElement("div"));
		await act(async () => root!.render(createElement(App)));

		const adapter = mocks.adapters.find(
			(candidate): candidate is ApprovalAdapter =>
				typeof (candidate as ApprovalAdapter).onRespondToToolApproval === "function",
		);

		await adapter!.onRespondToToolApproval!({
			approvalId: "permission-1",
			approved: true,
			optionId: "always",
		});

		expect(mocks.controller.replyToPermission).toHaveBeenCalledWith("permission-1", "always");
	});
});
