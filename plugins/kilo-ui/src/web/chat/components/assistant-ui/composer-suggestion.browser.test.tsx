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

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type * as AssistantUiReact from "@assistant-ui/react";
import type * as AssistantUiReactOpencode from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import type { KiloSuggestionRequest } from "../../suggestions/kilo-suggestion-logic.js";
import { Thread } from "./thread.js";

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

const pendingSuggestion: KiloSuggestionRequest = {
	id: "sug-1",
	sessionID: "session-1",
	text: "Run a local review of the uncommitted changes?",
	actions: [{ label: "Start review", prompt: "/review uncommitted" }],
	blocking: false,
};

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReactOpencode>();
	return {
		...actual,
		useOpenCodePermissions: () => ({ pending: [], reply: vi.fn() }),
		useOpenCodeQuestions: () => [],
		useOpenCodeThreadState: () => ({
			interactions: { permissions: { pending: {}, resolved: {} }, questions: { pending: {} } },
		}),
	};
});

vi.mock("../../suggestions/KiloSuggestionContext.js", () => ({
	usePendingKiloSuggestion: () => pendingSuggestion,
	useKiloSuggestionActions: () => ({
		accept: vi.fn(),
		dismiss: vi.fn(),
	}),
}));

vi.mock("../../plan/use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => ({
		byMessageId: new Map(),
		byAnchorCallId: new Map(),
		newest: undefined,
	}),
}));

// Suggest keeps the OpenCode run streaming; the prompt must still send.
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

const run = vi.hoisted(() =>
	vi.fn(async () => ({
		content: [{ type: "text" as const, text: "follow-up" }],
	})),
);

const stubChatModel: ChatModelAdapter = {
	run,
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
	agent: "code",
	setAgent: () => undefined,
	catalog: {
		agents: OPTIMISTIC_AGENT_CATALOG.agents.filter(
			(entry) => entry.name === "code" || entry.name === "plan",
		),
	},
	isCatalogPending: false,
	isCatalogError: false,
};

const seededMessages: ThreadMessageLike[] = [
	{
		role: "user",
		content: [{ type: "text", text: "Change the header" }],
	},
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Updated the header." },
			{
				type: "tool-call",
				toolCallId: "call-suggest",
				toolName: "suggest",
				args: {
					suggest: pendingSuggestion.text,
					actions: pendingSuggestion.actions,
				},
			},
		],
		status: { type: "running" },
	},
];

function ThreadHarness() {
	const runtime = useLocalRuntime(stubChatModel, { initialMessages: seededMessages });
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

function renderThread() {
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
						<ThreadHarness />
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	run.mockClear();
});

describe("composer while a suggestion is pending", () => {
	it("keeps Send available instead of Stop", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(pendingSuggestion.text)).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Stop generating" }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByText("Considering next steps")).not.toBeInTheDocument();
	});

	it("sends a follow-up from the composer without accepting the suggestion", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Skip the review and add tests instead");
		await expect.element(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
		await screen.getByRole("button", { name: "Send message" }).click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
	});

	it("sends a follow-up on Enter while the suggestion is pending", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Skip the review and add tests instead");
		await userEvent.type(input, "{Enter}");

		await expect.poll(() => run.mock.calls.length).toBe(1);
	});
});
