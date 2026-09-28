import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ReactOpenCode from "@assistant-ui/react-opencode";
import { page } from "vitest/browser";

import {
	createOpenCodeThreadState,
	type OpenCodePermissionRequest,
	type OpenCodeQuestionRequest,
	type OpenCodeThreadState,
} from "@assistant-ui/react-opencode";

const runtime = vi.hoisted(() => ({
	permissions: [] as OpenCodePermissionRequest[],
	questions: [] as OpenCodeQuestionRequest[],
	state: undefined as OpenCodeThreadState | undefined,
	replyToPermission: vi.fn(async () => undefined),
}));

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => ({
	...(await importOriginal<typeof ReactOpenCode>()),
	useOpenCodePermissions: () => ({
		pending: runtime.permissions,
		reply: runtime.replyToPermission,
	}),
	useOpenCodeQuestions: () => runtime.questions,
	useOpenCodeRuntimeExtras: () => ({
		replyToPermission: runtime.replyToPermission,
		replyToQuestion: vi.fn(async () => undefined),
		rejectQuestion: vi.fn(async () => undefined),
	}),
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => (runtime.state ? { state: runtime.state } : undefined),
}));

import { act } from "react";
import { createStore } from "zustand/vanilla";

import { ChatAutoApproveProvider } from "../../auto-approve/ChatAutoApproveContext.js";
import { OpenCodeComposerInteraction } from "./opencode-composer-interaction.js";

const permission = (
	tool?: OpenCodePermissionRequest["tool"],
	askedAt = 1,
): OpenCodePermissionRequest => ({
	id: "permission-1",
	sessionId: "session-1",
	permission: "bash",
	patterns: [],
	metadata: {},
	always: [],
	tool,
	toolName: "bash",
	title: "Run a shell command",
	askedAt,
	raw: {} as OpenCodePermissionRequest["raw"],
});

const question = (askedAt: number): OpenCodeQuestionRequest => ({
	id: "question-1",
	sessionID: "session-1",
	askedAt,
	questions: [
		{
			question: "Which environment?",
			header: "Environment",
			options: [{ label: "Development", description: "Use local services" }],
			custom: false,
		},
	],
});

const withPendingPermission = (
	state: OpenCodeThreadState,
	request: OpenCodePermissionRequest,
): OpenCodeThreadState => ({
	...state,
	interactions: {
		...state.interactions,
		permissions: {
			...state.interactions.permissions,
			pending: { [request.id]: request },
		},
	},
});

const withTaskCall = (
	state: OpenCodeThreadState,
	childSessionId: string,
	description: string,
): OpenCodeThreadState => ({
	...state,
	messageOrder: ["task-message"],
	messagesById: {
		"task-message": {
			id: "task-message",
			info: undefined,
			shadowParts: undefined,
			parts: [
				{
					id: "task-part",
					type: "tool",
					tool: "task",
					callID: "task-call",
					state: { input: { description }, metadata: { sessionId: childSessionId } },
				} as never,
			],
		},
	},
});

afterEach(() => {
	cleanup();
	runtime.permissions.length = 0;
	runtime.questions.length = 0;
	runtime.state = undefined;
	runtime.replyToPermission.mockClear();
});

describe("OpenCodeComposerInteraction", () => {
	it("replaces the composer with a linked pending permission", async () => {
		runtime.permissions.push(permission({ messageID: "message-1", callID: "call-1" }));
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Run a shell command")).toBeVisible();
		await expect.element(screen.getByText("Message composer")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Allow once" }).click();
		await expect
			.poll(() => runtime.replyToPermission.mock.calls)
			.toEqual([["permission-1", "once"]]);
	});

	it("does not approve a permission when Enter is pressed in an editable control", async () => {
		runtime.permissions.push(permission({ messageID: "message-1", callID: "call-1" }));
		const { getByRole } = render(
			<>
				<textarea aria-label="Unrelated editor" />
				<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />
			</>,
		);

		fireEvent.keyDown(getByRole("textbox", { name: "Unrelated editor" }), { key: "Enter" });

		expect(runtime.replyToPermission).not.toHaveBeenCalled();
	});

	it("does not show the card in Auto mode, but reveals it when auto-approve reports a failure", async () => {
		runtime.permissions.push(permission({ messageID: "message-1", callID: "call-1" }, Date.now()));
		const revealedIds = createStore(() => ({ ids: new Set<string>() as ReadonlySet<string> }));
		const { baseElement } = render(
			<ChatAutoApproveProvider value={{ enabled: true, revealedIds }}>
				<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />
			</ChatAutoApproveProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Message composer")).toBeVisible();
		await expect.element(screen.getByText("Run a shell command")).not.toBeInTheDocument();

		act(() => revealedIds.setState({ ids: new Set(["permission-1"]) }));

		await expect.element(screen.getByText("Run a shell command")).toBeVisible();
		await expect.element(screen.getByText("Message composer")).not.toBeInTheDocument();
	});

	it("shows the card in Auto mode once the request has waited too long to be auto-approved", async () => {
		runtime.permissions.push(permission(undefined, Date.now() - 2_900));
		const { baseElement } = render(
			<ChatAutoApproveProvider value={{ enabled: true }}>
				<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />
			</ChatAutoApproveProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Message composer")).toBeVisible();
		await expect.element(screen.getByText("Run a shell command")).toBeVisible();
	});

	it("always shows prompts that need a person in Auto mode", async () => {
		runtime.permissions.push({
			...permission(undefined, Date.now()),
			metadata: { sandboxEscalation: true },
		});
		const { baseElement } = render(
			<ChatAutoApproveProvider value={{ enabled: true }}>
				<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />
			</ChatAutoApproveProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Run a shell command")).toBeVisible();
	});

	it("renders the composer when no interaction is pending", async () => {
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Message composer")).toBeVisible();
	});

	it("shows the oldest pending question or permission", async () => {
		runtime.permissions.push(permission(undefined, 2));
		runtime.questions.push(question(1));
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Which environment?")).toBeVisible();
		await expect.element(screen.getByText("Run a shell command")).not.toBeInTheDocument();
	});

	it("leaves plan follow-up questions to the composer Refine action", async () => {
		runtime.questions.push({
			id: "plan-followup-1",
			sessionID: "session-1",
			askedAt: 1,
			questions: [
				{
					question: "Ready to implement?",
					header: "Implement",
					options: [
						{ label: "Continue here", description: "Implement the plan" },
						{ label: "Keep refining", description: "Stay in plan mode" },
					],
					custom: false,
				},
			],
		});
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Message composer")).toBeVisible();
		await expect.element(screen.getByText("Ready to implement?")).not.toBeInTheDocument();
	});

	it("surfaces a nested subagent's permission as a labelled composer prompt", async () => {
		const grandchildPermission = {
			...permission(undefined, 5),
			id: "permission-grandchild",
			sessionId: "grandchild",
			title: "List scoped dirs",
		};
		const grandchild = withPendingPermission(
			createOpenCodeThreadState("grandchild"),
			grandchildPermission,
		);
		const child = {
			...withTaskCall(createOpenCodeThreadState("child"), "grandchild", "Audit scoped dirs"),
			childSessionsById: { grandchild },
		};
		runtime.state = {
			...withTaskCall(createOpenCodeThreadState("session-1"), "child", "Explore"),
			childSessionsById: { child },
		};
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("List scoped dirs")).toBeVisible();
		await expect.element(screen.getByText("Subagent permission request")).toBeVisible();
		await expect
			.element(
				screen.getByText("The subagent “Audit scoped dirs” is requesting permission to use bash."),
			)
			.toBeVisible();
		await expect.element(screen.getByText("Message composer")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Allow once" }).click();
		await expect
			.poll(() => runtime.replyToPermission.mock.calls)
			.toEqual([["permission-grandchild", "once"]]);
	});

	it("puts the chat's own older permission ahead of a subagent's", async () => {
		runtime.permissions.push(permission(undefined, 1));
		runtime.state = {
			...createOpenCodeThreadState("session-1"),
			childSessionsById: {
				child: withPendingPermission(createOpenCodeThreadState("child"), {
					...permission(undefined, 2),
					id: "permission-child",
					sessionId: "child",
					title: "Child command",
				}),
			},
		};
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Run a shell command")).toBeVisible();
		await expect.element(screen.getByText("Permission request")).toBeVisible();
		await expect.element(screen.getByText("Child command")).not.toBeInTheDocument();
	});
});
