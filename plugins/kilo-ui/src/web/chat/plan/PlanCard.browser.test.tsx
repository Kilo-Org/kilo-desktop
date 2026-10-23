import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type * as AssistantUiReact from "@assistant-ui/react";

import { ChatAgentSelectionProvider } from "../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../connection/ChatConnectionContext.js";
import { useRightPanelStore } from "../../session/right-panel/right-panel-store.js";
import { PlanCard } from "./PlanCard.js";
import { SessionsFixture } from "../../session/test-helpers.js";
// The fixture chat's session shares its id, to keep assertions readable.
const PLAN_SESSION_CHATS = { "session-plan": "session-plan" };

import type { PlanProjection } from "./plan-projection.js";
import { resetPlanApprovalUiState } from "./use-approve-plan.js";

const planThreadProjectionState = vi.hoisted(() => ({
	newestAnchorCallId: undefined as string | undefined,
}));

const pendingQuestionsState = vi.hoisted(() => ({
	questions: [
		{
			id: "q-plan",
			sessionID: "session-plan",
			askedAt: 1,
			questions: [
				{
					question: "Ready to implement?",
					header: "Implement",
					options: [
						{ label: "Start new session" },
						{ label: "Continue here" },
						{ label: "Keep refining" },
					],
				},
			],
		},
	] as Array<{
		id: string;
		sessionID: string;
		askedAt: number;
		questions: Array<{
			question: string;
			header: string;
			options: Array<{ label: string }>;
		}>;
	}>,
}));

const replyToQuestion = vi.fn().mockResolvedValue(undefined);
const setAgent = vi.fn();
const append = vi.fn();
const createKiloDirectoryClient = vi.hoisted(() =>
	vi.fn(() => ({
		file: {
			read: vi.fn().mockResolvedValue({
				data: {
					content: "# Loaded from file\n\n- recovered step",
				},
			}),
		},
	})),
);

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		useAuiState: (
			selector: (state: {
				threadListItem: { remoteId: string };
				thread: {
					extras: {
						session: { id: string; directory: string };
						replyToQuestion: typeof replyToQuestion;
						rejectQuestion: ReturnType<typeof vi.fn>;
						replyToPermission: ReturnType<typeof vi.fn>;
					};
				};
			}) => unknown,
		) =>
			selector({
				threadListItem: { remoteId: "session-plan" },
				thread: {
					extras: {
						session: { id: "session-plan", directory: "/workspace" },
						replyToQuestion,
						rejectQuestion: vi.fn(),
						replyToPermission: vi.fn(),
					},
				},
			}),
		useAui: () => ({
			thread: { append },
			composer: {
				getState: () => ({ text: "", isEmpty: true }),
				setText: vi.fn(),
				send: vi.fn(),
			},
		}),
	};
});

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeQuestions: () => pendingQuestionsState.questions,
}));

vi.mock("./use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => ({
		byMessageId: new Map(),
		byAnchorCallId: new Map(),
		newest: planThreadProjectionState.newestAnchorCallId
			? { anchorCallId: planThreadProjectionState.newestAnchorCallId }
			: undefined,
	}),
}));

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient,
}));

function renderPlanCard(projection: PlanProjection) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<ChatConnectionProvider
				status={{
					isPending: false,
					isError: false,
					error: null,
					connection: {
						baseUrl: "http://127.0.0.1:4096",
						username: "kilo",
						password: "kilo",
						version: "1.0.0",
						globalDirectory: "/kilo",
					},
					connectionPromise: Promise.resolve({
						baseUrl: "http://127.0.0.1:4096",
						username: "kilo",
						password: "kilo",
						version: "1.0.0",
						globalDirectory: "/kilo",
					}),
				}}
			>
				<ChatAgentSelectionProvider
					value={{
						agent: "plan",
						setAgent,
						catalog: undefined,
						isCatalogPending: false,
						isCatalogError: false,
					}}
				>
					<SessionsFixture chats={PLAN_SESSION_CHATS}>{children}</SessionsFixture>
				</ChatAgentSelectionProvider>
			</ChatConnectionProvider>
		</QueryClientProvider>
	);

	return render(<PlanCard projection={projection} />, { wrapper });
}

afterEach(() => {
	cleanup();
	planThreadProjectionState.newestAnchorCallId = undefined;
	pendingQuestionsState.questions = [
		{
			id: "q-plan",
			sessionID: "session-plan",
			askedAt: 1,
			questions: [
				{
					question: "Ready to implement?",
					header: "Implement",
					options: [
						{ label: "Start new session" },
						{ label: "Continue here" },
						{ label: "Keep refining" },
					],
				},
			],
		},
	];
	useRightPanelStore.setState({ bySessionId: {} });
	resetPlanApprovalUiState();
	vi.clearAllMocks();
});

describe("PlanCard", () => {
	it("shows Writing Plan while the plan file is being written", async () => {
		const { baseElement } = renderPlanCard({
			status: "writing",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship\n\n- step",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-plan-card")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-writing")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-writing")).toHaveTextContent("Writing Plan");
		await expect.element(screen.getByTestId("kilo-plan-approve")).not.toBeInTheDocument();
	});

	it("shows a ready card with View Plan and Approve", async () => {
		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1\n- step 2\n- step 3",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("kilo-plan-card"))
			.toHaveAttribute("data-plan-status", "ready");
		await expect.element(screen.getByText("Ship it")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-preview")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-view")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-approve")).toBeVisible();
	});

	it("loads plan preview from disk when follow-up edits omit full markdown", async () => {
		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "",
			anchorCallId: "edit-1",
			hiddenCallIds: new Set(["edit-1", "exit-2"]),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-plan-loading")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-preview")).toBeVisible();
		await expect.element(screen.getByText("Loaded from file")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-approve")).toBeVisible();
		expect(createKiloDirectoryClient).toHaveBeenCalledWith(
			expect.objectContaining({ baseUrl: "http://127.0.0.1:4096" }),
			"/workspace",
		);
	});

	it("opens the plan pane from View Plan with this card's anchor", async () => {
		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("kilo-plan-view").click();

		const state = useRightPanelStore.getState().bySessionId["session-plan"];
		expect(state?.activeTabId).toBe("plan");
		expect(state?.tabs).toEqual([
			{ instanceId: "plan", definitionId: "kilo-ui.plan", title: "Plan", ordinal: null },
		]);
		expect(state?.planAnchorCallId).toBe("write-1");
	});

	it("hides Approve on a superseded plan card after refinement", async () => {
		planThreadProjectionState.newestAnchorCallId = "edit-2";

		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-plan-view")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-plan-approve")).not.toBeInTheDocument();
	});

	it("answers Continue here and switches to the code agent on Approve", async () => {
		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("kilo-plan-approve").click();

		await vi.waitFor(() => expect(replyToQuestion).toHaveBeenCalledOnce());
		expect(setAgent).toHaveBeenCalledWith("code");
		expect(replyToQuestion).toHaveBeenCalledWith("q-plan", [["Continue here"]]);
		await expect.element(screen.getByTestId("kilo-plan-approved")).toBeVisible();
	});

	it("keeps showing Approved after the question leaves the pending list", async () => {
		const { baseElement } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("kilo-plan-approve").click();
		await vi.waitFor(() => expect(replyToQuestion).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("kilo-plan-approved")).toBeVisible();

		// Simulate the server removing the answered question from the pending list.
		// When the question disappears the key shifts from "question:<id>" to "fallback:<scope>".
		// The fix marks both keys, so the fallback key must also be in the store.
		pendingQuestionsState.questions = [];

		cleanup();
		const { baseElement: rerenderedBase } = renderPlanCard({
			status: "ready",
			path: ".kilo/plans/ship.md",
			markdown: "# Ship it\n\n- step 1",
			anchorCallId: "write-1",
			hiddenCallIds: new Set(["write-1", "exit-1"]),
		});
		const rerenderedScreen = page.elementLocator(rerenderedBase);

		await expect.element(rerenderedScreen.getByTestId("kilo-plan-approved")).toBeVisible();
	});
});
