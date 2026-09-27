import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ReactOpenCode from "@assistant-ui/react-opencode";
import { page } from "vitest/browser";
import {
	createOpenCodeThreadState,
	type OpenCodePermissionRequest,
} from "@assistant-ui/react-opencode";

const runtime = vi.hoisted(() => ({
	extras: undefined as unknown,
	thread: { messages: [] as unknown[] },
	replyToPermission: vi.fn(async () => undefined),
}));

vi.mock("../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => runtime.extras,
}));

vi.mock("@assistant-ui/react", () => ({
	ReadonlyThreadProvider: ({ children }: { children: React.ReactNode }) => children,
	useAuiState: (selector: (state: typeof runtime) => unknown) => selector(runtime),
}));

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => ({
	...(await importOriginal<typeof ReactOpenCode>()),
	useOpenCodePermissions: () => ({ pending: [], reply: vi.fn() }),
	useOpenCodeQuestions: () => [],
	useOpenCodeRuntimeExtras: () => ({
		replyToPermission: runtime.replyToPermission,
		replyToQuestion: vi.fn(async () => undefined),
		rejectQuestion: vi.fn(async () => undefined),
	}),
}));

vi.mock("../components/assistant-ui/thread.js", () => ({
	ReadonlyThread: () => <div data-qa-id="readonly-thread">Readonly transcript</div>,
}));

import { SubagentPane } from "./SubagentPane.js";

const props = {
	sessionId: "parent",
	instanceId: "subagent:child",
	title: "Explore agent",
	metadata: { childSessionId: "child" },
};

afterEach(() => {
	cleanup();
	runtime.extras = undefined;
	runtime.thread.messages = [];
	runtime.replyToPermission.mockClear();
});

describe("SubagentPane", () => {
	it("moves from loading to an empty child transcript", () => {
		const view = render(<SubagentPane {...props} />);
		expect(view.baseElement.querySelector('[data-qa-id="subagent-pane-loading"]')).not.toBeNull();

		const child = {
			...createOpenCodeThreadState("child"),
			loadState: { type: "ready" as const },
		};
		runtime.extras = {
			state: {
				...createOpenCodeThreadState("parent"),
				loadState: { type: "ready" as const },
				childSessionsById: { child },
			},
		};
		view.rerender(<SubagentPane {...props} />);

		expect(view.baseElement.querySelector('[data-qa-id="subagent-pane-empty"]')).not.toBeNull();
	});

	it("renders the readonly thread when projected child messages arrive", () => {
		const child = {
			...createOpenCodeThreadState("child"),
			loadState: { type: "ready" as const },
			messageOrder: ["message-1"],
			messagesById: {
				"message-1": {
					id: "message-1",
					info: {
						id: "message-1",
						sessionID: "child",
						role: "assistant" as const,
						time: { created: 1, completed: 2 },
						parentID: "message-0",
						modelID: "model",
						providerID: "provider",
						mode: "explore",
						agent: "explore",
						path: { cwd: "/tmp", root: "/tmp" },
						cost: 0,
						tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
					},
					parts: [
						{
							id: "part-1",
							sessionID: "child",
							messageID: "message-1",
							type: "text" as const,
							text: "Live child update",
						},
					],
					shadowParts: undefined,
				},
			},
		};
		runtime.extras = {
			state: {
				...createOpenCodeThreadState("parent"),
				loadState: { type: "ready" as const },
				childSessionsById: { child },
			},
		};
		runtime.thread.messages = [
			{
				metadata: {
					custom: {
						opencode: {
							parts: [
								{
									type: "tool",
									tool: "task",
									callID: "task-call",
									state: { metadata: { sessionId: "child" } },
								},
							],
						},
					},
				},
				content: [
					{
						type: "tool-call",
						toolCallId: "task-call",
						messages: [{ id: "child-message", role: "assistant", content: [] }],
					},
				],
			},
		];
		const view = render(<SubagentPane {...props} />);

		expect(
			view.baseElement.querySelector('[data-qa-id="subagent-pane-transcript"]'),
		).not.toBeNull();
		expect(view.baseElement.querySelector('[data-qa-id="readonly-thread"]')).not.toBeNull();
	});

	it("answers the subagent's pending permission from the pane without claiming Enter", async () => {
		const child = {
			...createOpenCodeThreadState("child"),
			loadState: { type: "ready" as const },
		};
		const request: OpenCodePermissionRequest = {
			id: "permission-child",
			sessionId: "child",
			permission: "bash",
			patterns: ["ls -la"],
			metadata: {},
			always: [],
			toolName: "bash",
			title: "List scoped dirs",
			askedAt: 1,
			raw: {} as OpenCodePermissionRequest["raw"],
		};
		runtime.extras = {
			state: {
				...createOpenCodeThreadState("parent"),
				loadState: { type: "ready" as const },
				childSessionsById: {
					child: {
						...child,
						interactions: {
							...child.interactions,
							permissions: {
								...child.interactions.permissions,
								pending: { [request.id]: request },
							},
						},
					},
				},
			},
		};
		const view = render(<SubagentPane {...props} />);
		const screen = page.elementLocator(view.baseElement);

		await expect.element(screen.getByText("List scoped dirs")).toBeVisible();
		fireEvent.keyDown(document.body, { key: "Enter" });
		expect(runtime.replyToPermission).not.toHaveBeenCalled();

		await screen.getByRole("button", { name: "Allow once" }).click();
		await expect
			.poll(() => runtime.replyToPermission.mock.calls)
			.toEqual([["permission-child", "once"]]);
	});

	it("shows an unavailable state after parent restoration cannot find the child", () => {
		runtime.extras = {
			state: {
				...createOpenCodeThreadState("parent"),
				loadState: { type: "ready" as const },
			},
		};
		const view = render(<SubagentPane {...props} />);

		expect(
			view.baseElement.querySelector('[data-qa-id="subagent-pane-unavailable"]'),
		).not.toBeNull();
	});
});
