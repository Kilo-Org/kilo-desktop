import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import type * as AssistantUiReact from "@assistant-ui/react";
import type * as AssistantUiReactOpencode from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { Thread } from "./thread.js";
import { resetPlanApprovalUiState } from "../../plan/use-approve-plan.js";

const signedInAuth: KiloAuthContextValue = {
	isLoading: false,
	connectionUnavailable: false,
	authenticated: true,
	profile: null,
	deviceAuth: { status: "idle" },
	isRefreshing: false,
	isSwitchingOrg: false,
	profileError: null,
	orgError: null,
	login: () => undefined,
	cancelLogin: () => undefined,
	logout: () => undefined,
	refreshProfile: () => undefined,
	setOrganization: () => undefined,
	dismissOrgError: () => undefined,
	openExternal: () => undefined,
};

const replyToQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const subagents = vi.hoisted(() => ({
	active: false,
	stopAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../subagents/SubagentActivityContext.js", () => ({
	useSubagentActivity: () => ({
		activities: [],
		activeActivities: [],
		activityByToolCallId: new Map(),
		hasActiveSubagents: subagents.active,
		stoppingIds: new Set(),
		stopSubagent: vi.fn(),
		stopAllSubagents: subagents.stopAll,
	}),
}));

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReactOpencode>();
	return {
		...actual,
		useOpenCodeQuestions: () => [
			{
				id: "q-plan",
				sessionID: "session-1",
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
		],
		useOpenCodeThreadState: () => ({
			interactions: { permissions: { pending: {}, resolved: {} }, questions: { pending: {} } },
		}),
	};
});

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => ({
		replyToQuestion,
		rejectQuestion: vi.fn(),
		replyToPermission: vi.fn(),
	}),
	selectOpenCodeExtras: () => undefined,
}));

vi.mock("../../plan/use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => ({
		byMessageId: new Map(),
		byAnchorCallId: new Map(),
		newest: undefined,
	}),
}));

// After plan_exit the OpenCode session stays busy; CTAs must still replace Stop.
vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		useAuiState: (selector: (state: { thread: { isRunning: boolean } }) => unknown) =>
			actual.useAuiState((state) =>
				selector({
					...state,
					thread: {
						...state.thread,
						isRunning: true,
					},
				}),
			),
	};
});

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

const modelSelection = {
	model: { providerID: "kilo", modelID: "test-model" },
	setModel: () => undefined,
	effort: undefined,
	setEffort: () => undefined,
	name: "Test Model",
	efforts: undefined,
	catalog: {
		providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
		models: [
			{
				id: "kilo/test-model",
				name: "Test Model",
				providerID: "kilo",
				modelID: "test-model",
			},
		],
		defaults: { kilo: "test-model" },
	},
	isCatalogPending: false,
	isCatalogError: false,
};

const agentSelection = {
	agent: "plan",
	setAgent: () => undefined,
	catalog: {
		agents: OPTIMISTIC_AGENT_CATALOG.agents.filter(
			(entry) => entry.name === "code" || entry.name === "plan",
		),
	},
	isCatalogPending: false,
	isCatalogError: false,
};

function ThreadHarness({ initialMessages }: { initialMessages?: readonly ThreadMessageLike[] }) {
	const runtime = useLocalRuntime(stubChatModel, {
		...(initialMessages === undefined ? {} : { initialMessages }),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatConnectionProvider
				status={{
					isPending: false,
					isError: false,
					error: null,
					connection,
					connectionPromise: Promise.resolve(connection),
				}}
			>
				<ChatModelSelectionProvider value={modelSelection}>
					<ChatAgentSelectionProvider value={agentSelection}>
						<Thread />
					</ChatAgentSelectionProvider>
				</ChatModelSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

function renderThread(initialMessages?: readonly ThreadMessageLike[]) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: {},
		handlers: {},
	});
	const system = createFakeFeatureSystem({
		sdks: { "kilo-ui": sdk },
	});

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness {...(initialMessages === undefined ? {} : { initialMessages })} />
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	resetPlanApprovalUiState();
	subagents.active = false;
	vi.clearAllMocks();
});

describe("composer plan follow-up CTAs", () => {
	const seededMessages: ThreadMessageLike[] = [
		{
			role: "user",
			content: [{ type: "text", text: "Plan a feature" }],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Here is the plan." }],
		},
	];

	it("shows a disabled Refine instead of Stop or the question questionnaire when empty", async () => {
		const { baseElement } = renderThread(seededMessages);
		const screen = page.elementLocator(baseElement);
		const refine = screen.getByTestId("kilo-composer-refine");

		await expect.element(screen.getByTestId("kilo-question-questionnaire")).not.toBeInTheDocument();
		await expect.element(refine).toBeVisible();
		await expect.element(refine).toBeDisabled();
		await expect.element(screen.getByTestId("kilo-composer-approve")).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole("button", { name: "Stop generating" }))
			.not.toBeInTheDocument();
	});

	it("keeps stop-all-subagents available while plan follow-up actions are showing", async () => {
		subagents.active = true;
		const { baseElement } = renderThread(seededMessages);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-refine")).toBeVisible();
		const stop = screen.getByRole("button", { name: "Stop generating" });
		await expect.element(stop).toBeVisible();
		await stop.click();
		await expect.poll(() => subagents.stopAll).toHaveBeenCalledOnce();
	});

	it("enables Refine when the composer has text", async () => {
		const { baseElement } = renderThread(seededMessages);
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });
		const refine = screen.getByTestId("kilo-composer-refine");

		await expect.element(refine).toBeDisabled();
		await input.fill("Tighten step 2");
		await expect.element(refine).toBeEnabled();
	});

	it("replies with the draft text when Refine is clicked", async () => {
		const { baseElement } = renderThread(seededMessages);
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });
		const refine = screen.getByTestId("kilo-composer-refine");

		await input.fill("Tighten step 2");
		await expect.element(refine).toBeEnabled();
		await refine.click();
		await vi.waitFor(() => expect(replyToQuestion).toHaveBeenCalledOnce());
		expect(replyToQuestion).toHaveBeenCalledWith("q-plan", [["Tighten step 2"]]);
	});

	it("submits refine on Enter while the plan follow-up is pending", async () => {
		const { baseElement } = renderThread(seededMessages);
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Tighten step 2");
		await expect.element(screen.getByTestId("kilo-composer-refine")).toBeEnabled();
		await userEvent.type(input, "{Enter}");
		await vi.waitFor(() => expect(replyToQuestion).toHaveBeenCalledOnce());
		expect(replyToQuestion).toHaveBeenCalledWith("q-plan", [["Tighten step 2"]]);
	});
});
