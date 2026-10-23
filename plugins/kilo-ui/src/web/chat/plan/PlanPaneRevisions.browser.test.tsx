import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { FC, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type * as AssistantUiReact from "@assistant-ui/react";
import type * as AssistantUiReactOpenCode from "@assistant-ui/react-opencode";
import type { Part, ToolPart } from "@assistant-ui/react-opencode";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { ChatAgentSelectionProvider } from "../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../connection/ChatConnectionContext.js";
import { PlanCard } from "./PlanCard.js";
import { findPlanProjectionByAnchorCallId, type PlanThreadSource } from "./plan-projection.js";
import { resetPlanApprovalUiState } from "./use-approve-plan.js";
import { usePlanThreadProjection } from "./use-plan-thread-projection.js";
import { PlanTab } from "./PlanTab.js";
import { useRightPanelStore } from "../../session/right-panel/right-panel-store.js";
import { SessionsFixture } from "../../session/test-helpers.js";
// The fixture chat's session shares its id, to keep assertions readable.
const PLAN_SESSION_CHATS = { "session-plan": "session-plan" };

/** OpenCode thread state is the system boundary; everything above it is real. */
const openCodeThread = vi.hoisted(() => {
	let source: unknown;
	const listeners = new Set<() => void>();
	return {
		get: () => source,
		set: (next: unknown) => {
			source = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
});

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => {
	const { useSyncExternalStore } = await import("react");
	return {
		...(await importOriginal<typeof AssistantUiReactOpenCode>()),
		useOpenCodeThreadState: <T,>(selector: (state: never) => T): T =>
			selector(useSyncExternalStore(openCodeThread.subscribe, openCodeThread.get) as never),
		useOpenCodeQuestions: () => [],
	};
});

vi.mock("@assistant-ui/react", async (importOriginal) => ({
	...(await importOriginal<typeof AssistantUiReact>()),
	useAuiState: (selector: (state: unknown) => unknown) =>
		selector({
			threadListItem: { remoteId: "session-plan", id: "session-plan" },
			thread: { extras: undefined },
		}),
	useAui: () => ({
		thread: { append: vi.fn() },
		composer: { getState: () => ({ text: "", isEmpty: true }), setText: vi.fn() },
	}),
}));

const PLAN_PATH = ".kilo/plans/ship.md";

const completedTool = (tool: string, callID: string, input: Record<string, unknown>): ToolPart => ({
	id: `part-${callID}`,
	sessionID: "session-plan",
	messageID: `message-${callID}`,
	type: "tool",
	tool,
	callID,
	state: {
		status: "completed",
		input,
		output: "",
		title: tool,
		metadata: tool === "plan_exit" ? { plan: PLAN_PATH } : {},
		time: { start: 1, end: 2 },
	},
});

const runningTool = (tool: string, callID: string, input: Record<string, unknown>): ToolPart => ({
	id: `part-${callID}`,
	sessionID: "session-plan",
	messageID: `message-${callID}`,
	type: "tool",
	tool,
	callID,
	state: { status: "running", input, time: { start: 1 } },
});

const writePlan = (callID: string, content: string) =>
	completedTool("write", callID, { filePath: PLAN_PATH, content });
const exitPlan = (callID: string) => completedTool("plan_exit", callID, {});

type Message = { id: string; role: "assistant" | "user"; parts?: readonly Part[] };

const threadOf = (messages: readonly Message[], busy = false): PlanThreadSource => ({
	sessionStatus: { type: busy ? "busy" : "idle" },
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(
		messages.map((message) => [
			message.id,
			{ info: { role: message.role, agent: "plan" }, parts: message.parts ?? [] },
		]),
	),
});

const V1: Message = {
	id: "a1",
	role: "assistant",
	parts: [writePlan("write-v1", "# Ship v1\n\n- first draft step"), exitPlan("exit-v1")],
};
const REFINE: Message = { id: "u1", role: "user" };
const V2_READY: Message = {
	id: "a2",
	role: "assistant",
	parts: [writePlan("write-v2", "# Ship v2\n\n- revised step"), exitPlan("exit-v2")],
};
const V3_READY: Message = {
	id: "a3",
	role: "assistant",
	parts: [writePlan("write-v3", "# Ship v3\n\n- final step"), exitPlan("exit-v3")],
};
const V2_WRITING: Message = {
	id: "a2",
	role: "assistant",
	parts: [
		runningTool("write", "write-v2", { filePath: PLAN_PATH, content: "# Ship v2\n\n- revised" }),
	],
};

const CardFor: FC<{ anchorCallId: string }> = ({ anchorCallId }) => {
	const projection = findPlanProjectionByAnchorCallId(usePlanThreadProjection(), anchorCallId);
	return projection ? (
		<div data-qa-id={`card-${anchorCallId}`}>
			<PlanCard projection={projection} />
		</div>
	) : null;
};

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "kilo",
	version: "1.0.0",
	globalDirectory: "/kilo",
};

function Providers({ children }: { children: ReactNode }) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<ChatConnectionProvider
					status={{
						isPending: false,
						isError: false,
						error: null,
						connection: CONNECTION,
						connectionPromise: Promise.resolve(CONNECTION),
					}}
				>
					<ChatAgentSelectionProvider
						value={{
							agent: "plan",
							setAgent: vi.fn(),
							catalog: undefined,
							isCatalogPending: false,
							isCatalogError: false,
						}}
					>
						<SessionsFixture chats={PLAN_SESSION_CHATS}>{children}</SessionsFixture>
					</ChatAgentSelectionProvider>
				</ChatConnectionProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
}

function renderPlanPane(initial: PlanThreadSource, cardAnchors: readonly string[]) {
	openCodeThread.set(initial);
	const result = render(
		<Providers>
			{cardAnchors.map((anchor) => (
				<CardFor key={anchor} anchorCallId={anchor} />
			))}
			<PlanTab sessionId="session-plan" />
		</Providers>,
	);
	return page.elementLocator(result.baseElement);
}

const advanceThread = (next: PlanThreadSource) => act(() => openCodeThread.set(next));

const planPaneText = () =>
	document.querySelector('[data-qa-id="chat-pane-plan"]')?.textContent ?? "";

const expectPlanPaneToShow = (...fragments: string[]) =>
	vi.waitFor(() => {
		for (const fragment of fragments) expect(planPaneText()).toContain(fragment);
	});

afterEach(() => {
	cleanup();
	useRightPanelStore.setState({ bySessionId: {} });
	resetPlanApprovalUiState();
});

describe("plan pane follows plan revisions", () => {
	it("shows the refined plan once the revision is ready, without another View Plan click", async () => {
		const screen = renderPlanPane(threadOf([V1]), ["write-v1"]);
		await screen.getByTestId("card-write-v1").getByTestId("kilo-plan-view").click();
		await expectPlanPaneToShow("Ship v1");

		advanceThread(threadOf([V1, REFINE, V2_READY]));

		await expectPlanPaneToShow("Ship v2", "revised step");
	});

	it("keeps the opened plan while the revision is still being written", async () => {
		const screen = renderPlanPane(threadOf([V1]), ["write-v1", "write-v2"]);
		await screen.getByTestId("card-write-v1").getByTestId("kilo-plan-view").click();
		await expectPlanPaneToShow("Ship v1");

		advanceThread(threadOf([V1, REFINE, V2_WRITING], true));

		await expect.element(screen.getByTestId("kilo-plan-writing")).toBeVisible();
		expect(planPaneText()).toContain("first draft step");
		expect(planPaneText()).not.toContain("Ship v2");
	});

	it("follows a revision that was still being written when the plan was opened", async () => {
		const screen = renderPlanPane(threadOf([V1, REFINE, V2_WRITING], true), [
			"write-v1",
			"write-v2",
		]);
		await screen.getByTestId("card-write-v1").getByTestId("kilo-plan-view").click();
		await expectPlanPaneToShow("Ship v1");

		advanceThread(threadOf([V1, REFINE, V2_READY]));

		await expectPlanPaneToShow("Ship v2", "revised step");
	});

	it("shows an older plan the user opened until a newer revision finishes", async () => {
		const withV2 = [V1, REFINE, V2_READY];
		const screen = renderPlanPane(threadOf(withV2), ["write-v1", "write-v2"]);
		await screen.getByTestId("card-write-v1").getByTestId("kilo-plan-view").click();
		await expectPlanPaneToShow("Ship v1", "first draft step");

		advanceThread(threadOf([...withV2, { id: "u2", role: "user" }, V3_READY]));

		await expectPlanPaneToShow("Ship v3", "final step");
	});

	it("shows the newest plan when the tab was opened without a snapshot", async () => {
		renderPlanPane(threadOf([V1]), []);
		act(() => useRightPanelStore.getState().openPlan("session-plan"));
		await expectPlanPaneToShow("Ship v1");

		advanceThread(threadOf([V1, REFINE, V2_READY]));

		await expectPlanPaneToShow("Ship v2");
	});
});
