import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type {
	OpenCodePermissionRequest,
	OpenCodeQuestionRequest,
} from "@assistant-ui/react-opencode";

const runtime = vi.hoisted(() => ({
	permissions: [] as OpenCodePermissionRequest[],
	questions: [] as OpenCodeQuestionRequest[],
	replyToPermission: vi.fn(async () => undefined),
}));

vi.mock("@assistant-ui/react-opencode", () => ({
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

afterEach(() => {
	cleanup();
	runtime.permissions.length = 0;
	runtime.questions.length = 0;
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
});
