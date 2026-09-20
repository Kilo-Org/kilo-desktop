import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type {
	OpenCodePermissionRequest,
	OpenCodeQuestionRequest,
} from "@assistant-ui/react-opencode";

import type { KiloSuggestionRequest } from "../../suggestions/kilo-suggestion-logic.js";

const runtime = vi.hoisted(() => ({
	permissions: [] as OpenCodePermissionRequest[],
	questions: [] as OpenCodeQuestionRequest[],
	suggestion: null as KiloSuggestionRequest | null,
	replyToPermission: vi.fn(async () => undefined),
	acceptSuggestion: vi.fn(async () => undefined),
	dismissSuggestion: vi.fn(async () => undefined),
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

vi.mock("../../suggestions/KiloSuggestionContext.js", () => ({
	usePendingKiloSuggestion: () => runtime.suggestion,
	useKiloSuggestionActions: () => ({
		accept: runtime.acceptSuggestion,
		dismiss: runtime.dismissSuggestion,
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
	runtime.suggestion = null;
	runtime.replyToPermission.mockClear();
	runtime.acceptSuggestion.mockClear();
	runtime.dismissSuggestion.mockClear();
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

	it("shows a pending suggestion above the composer", async () => {
		runtime.suggestion = {
			id: "sug-1",
			sessionID: "session-1",
			text: "Run a local review?",
			actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
		};
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Run a local review?")).toBeVisible();
		await expect.element(screen.getByText("Message composer")).toBeVisible();

		await screen.getByRole("button", { name: "Start review" }).click();
		await expect.poll(() => runtime.acceptSuggestion.mock.calls).toEqual([[runtime.suggestion, 0]]);
	});

	it("dismisses a pending suggestion without hiding the composer", async () => {
		runtime.suggestion = {
			id: "sug-1",
			sessionID: "session-1",
			text: "Run a local review?",
			actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
		};
		const { baseElement } = render(
			<OpenCodeComposerInteraction fallback={<div>Message composer</div>} />,
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Dismiss suggestion" }).click();
		await expect.poll(() => runtime.dismissSuggestion.mock.calls).toEqual([[runtime.suggestion]]);
		await expect.element(screen.getByText("Message composer")).toBeVisible();
	});
});
