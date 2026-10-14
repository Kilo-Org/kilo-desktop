import {
	AuiProvider,
	AssistantRuntimeProvider,
	ExternalThread,
	fromThreadMessageLike,
	useAui,
	useAuiState,
	useLocalRuntime,
	type ChatModelAdapter,
	type ExternalThreadMessage,
	type ExternalThreadQueueAdapter,
	type QueueItemState,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type * as SessionModelUsage from "../../usage/session-model-usage.js";
import type * as SubagentActivityContext from "../../subagents/SubagentActivityContext.js";

vi.mock("../../usage/session-model-usage.js", async (importOriginal) => {
	const actual = await importOriginal<typeof SessionModelUsage>();
	return {
		...actual,
		fetchSessionModelUsage: vi.fn().mockResolvedValue(undefined),
	};
});

import {
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	signInRequiredToolMessage,
	type ToolDefinition,
} from "@kilo-desktop/feature-sdk";
import type {
	AgentToolSignInCapability,
	AgentToolSignInState,
} from "@kilo-desktop/plugin-kilo-server/contracts";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import type * as ReactOpenCode from "@assistant-ui/react-opencode";
import type { OpenCodeQuestionRequest, OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { ChatMarkdownProvider } from "../../ChatMarkdownContext.js";
import { WorktreeSetupProvider } from "../../worktree-setup/WorktreeSetupContext.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import {
	ChatConnectionProvider,
	type ChatConnectionStatus,
} from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { useDelegationRevealStore } from "../../subagents/delegation-reveal-store.js";
import { Thread } from "./thread.js";

const extrasRef = vi.hoisted(() => ({
	current: undefined as OpenCodeRuntimeExtras | undefined,
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => extrasRef.current,
	selectOpenCodeExtras: () => extrasRef.current,
}));

const pendingQuestionsRef = vi.hoisted(() => ({
	current: [] as OpenCodeQuestionRequest[],
}));

const subagentsRef = vi.hoisted(() => ({ active: false }));

vi.mock("../../subagents/SubagentActivityContext.js", async (importOriginal) => {
	const actual = await importOriginal<typeof SubagentActivityContext>();
	return {
		...actual,
		useSubagentActivity: () => ({
			...actual.useSubagentActivity(),
			hasActiveSubagents: subagentsRef.active,
		}),
	};
});

vi.mock("@assistant-ui/react-opencode", async (importOriginal) => {
	const actual = await importOriginal<typeof ReactOpenCode>();
	return {
		...actual,
		useOpenCodeQuestions: () => pendingQuestionsRef.current,
	};
});

const retryFailedTurn = vi.hoisted(() =>
	vi.fn(
		async (_args: {
			connection: unknown;
			sessionID: string;
			directory: string;
			messageID: string;
			model?: unknown;
		}) => undefined,
	),
);

const tellAgentToolsAvailable = vi.hoisted(() =>
	vi.fn(
		async (_args: {
			connection: unknown;
			sessionID: string;
			directory: string;
			toolsLabel: string;
		}) => undefined,
	),
);

vi.mock("../tools/tell-agent-tools-available.js", () => ({
	tellAgentToolsAvailable: (args: Parameters<typeof tellAgentToolsAvailable>[0]) =>
		tellAgentToolsAvailable(args),
}));

vi.mock("./retry-failed-turn.js", () => ({
	retryFailedTurn: (args: Parameters<typeof retryFailedTurn>[0]) => retryFailedTurn(args),
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	extrasRef.current = undefined;
	pendingQuestionsRef.current = [];
	subagentsRef.active = false;
	retryFailedTurn.mockClear();
	useDelegationRevealStore.setState({ request: null });
});

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

const signedOutAuth: KiloAuthContextValue = {
	...signedInAuth,
	authenticated: false,
};

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

const kiloModelSelection = {
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

type ChatModelSelectionValue = ComponentProps<typeof ChatModelSelectionProvider>["value"];

const localModelSelection = {
	...kiloModelSelection,
	model: { providerID: "kilo-desktop-model-server", modelID: "qwen-3" },
	name: "Qwen 3",
	catalog: {
		providers: [{ id: "kilo-desktop-model-server", name: "Local", connected: true }],
		models: [
			{
				id: "kilo-desktop-model-server/qwen-3",
				name: "Qwen 3",
				providerID: "kilo-desktop-model-server",
				modelID: "qwen-3",
			},
		],
		defaults: { "kilo-desktop-model-server": "qwen-3" },
	},
} satisfies ChatModelSelectionValue;

const responsiveModelSelection = {
	...kiloModelSelection,
	model: { providerID: "spacexai", modelID: "grok-4.6" },
	effort: "medium",
	name: "SpaceXAI: Grok 4.6",
	efforts: [{ id: "medium", name: "Med" }],
	catalog: {
		providers: [{ id: "spacexai", name: "SpaceXAI", connected: true }],
		models: [
			{
				id: "spacexai/grok-4.6",
				name: "SpaceXAI: Grok 4.6",
				providerID: "spacexai",
				modelID: "grok-4.6",
				efforts: [{ id: "medium", name: "Med" }],
			},
		],
		defaults: { spacexai: "grok-4.6" },
	},
} satisfies ChatModelSelectionValue;

const anthropicModelSelection = {
	...kiloModelSelection,
	model: { providerID: "anthropic", modelID: "claude-sonnet" },
	name: "Claude Sonnet",
	catalog: {
		providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
		models: [
			{
				id: "anthropic/claude-sonnet",
				name: "Claude Sonnet",
				providerID: "anthropic",
				modelID: "claude-sonnet",
			},
		],
		defaults: { anthropic: "claude-sonnet" },
	},
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

const gatewayAuthDump =
	'Unauthorized: {"error":{"code":"PAID_MODEL_AUTH_REQUIRED","message":"You need to sign in to use this model."},"error_type":"paid_model_auth_required"}';

function signInErrorMessages(
	error = "You need to sign in to use this model",
): readonly ThreadMessageLike[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text: "Hello" }],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "" }],
			status: {
				type: "incomplete",
				reason: "error",
				error,
			},
		},
	];
}

function makeExtras(session: Record<string, unknown> | null): OpenCodeRuntimeExtras {
	return {
		session: session as never,
		state: { messageOrder: [], messagesById: {} } as never,
		permissions: {},
		questions: {},
		fork: vi.fn(async () => "forked"),
		revert: vi.fn(async () => undefined),
		unrevert: vi.fn(async () => undefined),
		cancel: vi.fn(async () => undefined),
		refresh: vi.fn(async () => undefined),
		replyToPermission: vi.fn(async () => undefined),
		replyToQuestion: vi.fn(async () => undefined),
		rejectQuestion: vi.fn(async () => undefined),
	};
}

function LastUserIdProbe() {
	const lastUserId = useAuiState((s) => {
		const last = s.thread.messages.findLast((message) => message.role === "user");
		return last?.id ?? "";
	});
	return <output data-qa-id="last-user-id">{lastUserId}</output>;
}

/** Lets a test change the Kilo auth state of a rendered thread (e.g. sign-in completes). */
type AuthControl = { set?: (auth: KiloAuthContextValue) => void };

function ThreadTree({
	auth,
	selection = kiloModelSelection,
	initialMessages,
	adapter = stubChatModel,
	enableMessageQueue = false,
	connectionStatus = {
		isPending: false,
		isError: false,
		error: null,
		connection,
		connectionPromise: Promise.resolve(connection),
	},
	probe = false,
	isSettingUpWorktree = false,
	authControl,
}: {
	auth: KiloAuthContextValue;
	authControl?: AuthControl;
	selection?: ChatModelSelectionValue;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
	enableMessageQueue?: boolean;
	connectionStatus?: ChatConnectionStatus;
	probe?: boolean;
	isSettingUpWorktree?: boolean;
}) {
	const runtime = useLocalRuntime(adapter, {
		initialMessages,
		unstable_enableMessageQueue: enableMessageQueue,
	});
	const [controlledAuth, setControlledAuth] = useState(auth);
	if (authControl) authControl.set = setControlledAuth;
	return (
		<KiloAuthContext.Provider value={authControl ? controlledAuth : auth}>
			<AssistantRuntimeProvider runtime={runtime}>
				<ChatConnectionProvider status={connectionStatus}>
					<ChatAgentSelectionProvider value={agentSelection}>
						<ChatModelSelectionProvider value={selection}>
							<ChatMarkdownProvider
								sessionId="session-1"
								workspaceFolders={[{ path: "/workspace/project", isPrimary: true }]}
							>
								<WorktreeSetupProvider isSettingUp={isSettingUpWorktree}>
									<div className="h-[480px]">
										<Thread />
										{probe ? <LastUserIdProbe /> : null}
									</div>
								</WorktreeSetupProvider>
							</ChatMarkdownProvider>
						</ChatModelSelectionProvider>
					</ChatAgentSelectionProvider>
				</ChatConnectionProvider>
			</AssistantRuntimeProvider>
		</KiloAuthContext.Provider>
	);
}

function renderThread({
	auth = signedInAuth,
	selection = kiloModelSelection,
	initialMessages,
	adapter,
	enableMessageQueue,
	connectionStatus,
	extras,
	openFile,
	isSettingUpWorktree,
	authControl,
	agentToolSignIn,
	environmentsTools = [envsListTool],
	notebookTools = [],
}: {
	auth?: KiloAuthContextValue;
	authControl?: AuthControl;
	agentToolSignIn?: AgentToolSignInCapability;
	/** Tools registered as the environments plugin would, e.g. with a sign-in prompt. */
	environmentsTools?: readonly ToolDefinition[];
	/** Tools registered as the notebook plugin would. */
	notebookTools?: readonly ToolDefinition[];
	selection?: ChatModelSelectionValue;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
	enableMessageQueue?: boolean;
	connectionStatus?: ChatConnectionStatus;
	extras?: OpenCodeRuntimeExtras;
	openFile?: (options: {
		sessionId: string;
		workspaceDirectory: string;
		relativePath: string;
	}) => void;
	isSettingUpWorktree?: boolean;
}) {
	extrasRef.current = extras;
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	if (openFile) system.getSdk("files").plugins.expose("fileViewer", { openFile });
	if (agentToolSignIn) {
		system.getSdk("kilo-server").plugins.expose("agentToolSignIn", { ...agentToolSignIn });
	}
	for (const tool of environmentsTools) system.getSdk("environments").tools.register(tool);
	for (const tool of notebookTools) system.getSdk("notebook").tools.register(tool);
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ThreadTree
						auth={auth}
						selection={selection}
						initialMessages={initialMessages}
						{...(authControl ? { authControl } : {})}
						{...(enableMessageQueue === undefined ? {} : { enableMessageQueue })}
						{...(adapter ? { adapter } : {})}
						{...(connectionStatus ? { connectionStatus } : {})}
						{...(isSettingUpWorktree === undefined ? {} : { isSettingUpWorktree })}
						probe={extras !== undefined}
					/>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

describe("worktree setup indicator", () => {
	it("appears after the optimistic user message while the worktree is being created", async () => {
		const screen = renderThread({
			initialMessages: [{ role: "user", content: [{ type: "text", text: "Start the task" }] }],
			isSettingUpWorktree: true,
		});

		const indicator = screen.getByRole("status", { name: "Setting up worktree" });
		await expect.element(indicator).toBeVisible();
		await expect.element(screen.getByTestId("kilo-worktree-setup-spinner")).toBeVisible();
	});

	it("is absent when no worktree creation is pending", async () => {
		const screen = renderThread({
			initialMessages: [{ role: "user", content: [{ type: "text", text: "Start locally" }] }],
		});

		await expect
			.element(screen.getByRole("status", { name: "Setting up worktree" }))
			.not.toBeInTheDocument();
	});
});

function renderThreadWithInference({
	initialMessages = [],
	selection = kiloModelSelection,
}: {
	initialMessages?: readonly ThreadMessageLike[];
	selection?: ChatModelSelectionValue;
} = {}) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const localInference = system.getSdk("local-inference");
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ThreadTree auth={signedInAuth} selection={selection} initialMessages={initialMessages} />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), localInference };
}

type QueueItemWithAttachmentPreview = QueueItemState & {
	readonly attachmentPreview?: {
		readonly name: string;
		readonly src?: string;
	};
};

function ExternalQueueThreadTree({
	queue,
	isRunning = true,
	connectionStatus,
}: {
	queue: ExternalThreadQueueAdapter;
	isRunning?: boolean;
	connectionStatus?: ChatConnectionStatus;
}) {
	const aui = useAui({ thread: ExternalThread({ messages: [], isRunning, queue }) });

	return (
		<KiloAuthContext.Provider value={signedInAuth}>
			<AuiProvider value={aui}>
				<ChatConnectionProvider
					status={
						connectionStatus ?? {
							isPending: false,
							isError: false,
							error: null,
							connection,
							connectionPromise: Promise.resolve(connection),
						}
					}
				>
					<ChatAgentSelectionProvider value={agentSelection}>
						<ChatModelSelectionProvider value={kiloModelSelection}>
							<div className="h-[480px]">
								<Thread />
							</div>
						</ChatModelSelectionProvider>
					</ChatAgentSelectionProvider>
				</ChatConnectionProvider>
			</AuiProvider>
		</KiloAuthContext.Provider>
	);
}

function renderExternalQueueThread(
	queue: ExternalThreadQueueAdapter,
	options?: { isRunning?: boolean; connectionStatus?: ChatConnectionStatus },
) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ExternalQueueThreadTree queue={queue} {...options} />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

function ExternalMessagesThreadTree({
	messages,
	isRunning,
}: {
	messages: readonly ExternalThreadMessage[];
	isRunning: boolean;
}) {
	const aui = useAui({ thread: ExternalThread({ messages, isRunning }) });

	return (
		<KiloAuthContext.Provider value={signedInAuth}>
			<AuiProvider value={aui}>
				<ChatConnectionProvider
					status={{
						isPending: false,
						isError: false,
						error: null,
						connection,
						connectionPromise: Promise.resolve(connection),
					}}
				>
					<ChatAgentSelectionProvider value={agentSelection}>
						<ChatModelSelectionProvider value={kiloModelSelection}>
							<div className="h-[480px]">
								<Thread />
							</div>
						</ChatModelSelectionProvider>
					</ChatAgentSelectionProvider>
				</ChatConnectionProvider>
			</AuiProvider>
		</KiloAuthContext.Provider>
	);
}

function renderExternalMessagesThread(
	messages: readonly ExternalThreadMessage[],
	isRunning: boolean,
) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (next: readonly ExternalThreadMessage[], running: boolean) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ExternalMessagesThreadTree messages={next} isRunning={running} />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
	const { baseElement, rerender } = render(tree(messages, isRunning));
	return Object.assign(page.elementLocator(baseElement), {
		update: (next: readonly ExternalThreadMessage[], running: boolean) =>
			rerender(tree(next, running)),
	});
}

describe("user file mentions", () => {
	it("opens a sent file mention in the workspace file viewer", async () => {
		const openFile = vi.fn();
		const screen = renderThread({
			initialMessages: [
				{ role: "user", content: [{ type: "text", text: "Review @/src/App.tsx" }] },
			],
			openFile,
		});

		await screen.getByRole("button", { name: "file: App.tsx" }).click();
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "src/App.tsx",
		});
	});
});

describe("conversation map visibility", () => {
	const message = (role: "user" | "assistant", text: string, id: string): ExternalThreadMessage =>
		fromThreadMessageLike({ role, content: [{ type: "text", text }] }, id, {
			type: "complete",
			reason: "stop",
		});

	it("stays hidden for one user turn", async () => {
		renderExternalMessagesThread(
			[
				message("user", "First prompt", "user-1"),
				message("assistant", "First answer", "assistant-1"),
			],
			false,
		);

		expect(document.querySelector('[data-slot="conversation-map-rail"]')).toBeNull();
	});

	it("appears after a second user turn", async () => {
		renderExternalMessagesThread(
			[
				message("user", "First prompt", "user-1"),
				message("assistant", "First answer", "assistant-1"),
				message("user", "Second prompt", "user-2"),
				message("assistant", "Second answer", "assistant-2"),
			],
			false,
		);

		expect(document.querySelector('[data-slot="conversation-map-rail"]')).not.toBeNull();
	});
});

describe("assistant message footer", () => {
	const message = (role: "user" | "assistant", text: string, id: string): ExternalThreadMessage =>
		fromThreadMessageLike({ role, content: [{ type: "text", text }] }, id, {
			type: "complete",
			reason: "stop",
		});

	it("is not overlapped by the next message, so its actions stay hoverable", async () => {
		renderExternalMessagesThread(
			[
				message("user", "First prompt", "user-1"),
				message("assistant", "First answer", "assistant-1"),
				message("user", "Second prompt", "user-2"),
			],
			false,
		);

		const footer = await vi.waitUntil(() =>
			document.querySelector('[data-slot="aui_assistant-message-footer"]'),
		);
		const nextMessage = document.querySelectorAll('[data-slot="aui_user-message-root"]')[1];
		expect(nextMessage).toBeDefined();
		expect(nextMessage!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			footer.getBoundingClientRect().bottom,
		);
	});
});

describe("composer local model send lock", () => {
	it("keeps the composer writable and replaces send while the model loads", async () => {
		const { screen, localInference } = renderThreadWithInference({
			selection: localModelSelection,
		});

		await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeEnabled();

		localInference.events.emit("status-changed", {
			status: "loading-model",
			modelId: "qwen-3",
		});

		await expect.element(screen.getByRole("button", { name: "Loading model..." })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Send message" }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeEnabled();

		localInference.events.emit("status-changed", {
			status: "ready",
			loadedModelId: "qwen-3",
		});

		await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Loading model..." }))
			.not.toBeInTheDocument();
	});

	it("does not send on Enter while the model is loading", async () => {
		const { screen, localInference } = renderThreadWithInference({
			selection: localModelSelection,
		});
		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("Hello from the composer");

		localInference.events.emit("status-changed", {
			status: "loading-model",
			modelId: "qwen-3",
		});
		await expect.element(screen.getByRole("button", { name: "Loading model..." })).toBeVisible();

		await userEvent.keyboard("{Enter}");
		await expect.element(input).toHaveTextContent("Hello from the composer");
		await expect
			.element(screen.getByRole("button", { name: "Send message" }))
			.not.toBeInTheDocument();
	});

	it("does not lock a non-local composer while a local model loads", async () => {
		const { screen, localInference } = renderThreadWithInference();

		localInference.events.emit("status-changed", {
			status: "loading-model",
			modelId: "qwen-3",
		});

		await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Loading model..." }))
			.not.toBeInTheDocument();
	});
});

describe("composer responsiveness", () => {
	it("places the model after the agent and the approval selector before Send", async () => {
		const screen = renderThread({ initialMessages: [] });
		const agent = screen.getByTestId("kilo-agent-selector-trigger").element();
		const model = screen.getByTestId("kilo-model-selector-trigger").element();
		const approval = screen.getByTestId("kilo-approval-selector-trigger").element();
		const send = screen.getByTestId("kilo-composer-send").element();
		expect(agent.nextElementSibling).toBe(model);
		expect(send.previousElementSibling).toBe(approval);
	});

	it("drops labels by priority before the toolbar can overlap", async () => {
		const screen = renderThread({
			selection: responsiveModelSelection,
			initialMessages: [],
		});
		const agentLabel = screen.getByText("Code");
		const modelLabel = screen.getByText("SpaceXAI: Grok 4.6");
		const reasoningLabel = screen.getByText("Med");
		const agentTrigger = screen.getByTestId("kilo-agent-selector-trigger").element();
		const toolbar = agentTrigger.closest<HTMLElement>(".aui-composer-action-wrapper");

		if (!toolbar) throw new Error("Composer toolbar was not rendered");
		toolbar.style.width = "520px";
		await expect.element(agentLabel).toBeVisible();
		await expect.element(modelLabel).toBeVisible();
		await expect.element(reasoningLabel).toBeVisible();

		toolbar.style.width = "440px";
		await expect.element(agentLabel).not.toBeVisible();
		await expect.element(modelLabel).toBeVisible();
		await expect.element(reasoningLabel).toBeVisible();
		expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);

		toolbar.style.width = "360px";
		await expect.element(agentLabel).not.toBeVisible();
		await expect.element(modelLabel).toBeVisible();
		await expect.element(reasoningLabel).not.toBeVisible();
		expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);

		toolbar.style.width = "270px";
		await expect.element(agentLabel).not.toBeVisible();
		await expect.element(modelLabel).not.toBeVisible();
		await expect.element(reasoningLabel).not.toBeVisible();
		expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
	});
});

describe("composer focus", () => {
	it("focuses an untouched draft when no pane owns focus", async () => {
		const screen = renderThread({ initialMessages: [] });

		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toHaveFocus();
	});

	it("does not steal focus from a pane when a pending connection resolves", async () => {
		let resolveConnection!: (value: KiloGlobalConnection) => void;
		const connectionPromise = new Promise<KiloGlobalConnection>((resolve) => {
			resolveConnection = resolve;
		});
		const screen = renderThread({
			initialMessages: [],
			connectionStatus: {
				isPending: true,
				isError: false,
				error: null,
				connectionPromise,
			},
		});
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start chat");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.element(screen.getByTestId("kilo-composer-connecting")).toBeVisible();

		const paneCanvas = document.createElement("div");
		paneCanvas.dataset.qaId = "kilo-chat-pane-canvas";
		const terminalFrame = document.createElement("iframe");
		paneCanvas.append(terminalFrame);
		document.body.append(paneCanvas);

		try {
			terminalFrame.focus();
			expect(document.activeElement).toBe(terminalFrame);

			resolveConnection(connection);

			await expect.element(screen.getByTestId("kilo-composer-connecting")).not.toBeInTheDocument();
			expect(document.activeElement).toBe(terminalFrame);
		} finally {
			paneCanvas.remove();
		}
	});
});

describe("composer message queue", () => {
	const createBlockingAdapter = () =>
		({
			run: vi.fn(
				({ abortSignal }) =>
					new Promise<never>((_resolve, reject) => {
						const abort = () =>
							reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
						if (abortSignal.aborted) {
							abort();
							return;
						}
						abortSignal.addEventListener("abort", abort, { once: true });
					}),
			),
		}) satisfies ChatModelAdapter;

	it("does not enqueue the first Enter that starts a run", async () => {
		const adapter = createBlockingAdapter();
		const screen = renderThread({
			initialMessages: [],
			adapter,
			enableMessageQueue: true,
		});
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start the long task");
		await userEvent.type(input, "{Enter}");
		await expect.poll(() => adapter.run.mock.calls.length).toBe(1);

		await expect.element(screen.getByText("1 queued")).not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Send now" })).not.toBeInTheDocument();
	});

	it("keeps the composer usable and renders queued prompts while a run is active", async () => {
		const adapter = createBlockingAdapter();
		const screen = renderThread({
			initialMessages: [],
			adapter,
			enableMessageQueue: true,
		});
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start the long task");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.poll(() => adapter.run.mock.calls.length).toBe(1);

		await input.fill("Queue this follow-up");
		await expect
			.element(screen.getByRole("button", { name: "Add message to queue" }))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Stop generating" })).toBeVisible();
		await userEvent.type(input, "{Enter}");

		await expect.element(screen.getByText("1 queued")).toBeVisible();
		await expect.element(screen.getByText("Queue this follow-up")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Send now" })).toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: "Delete queued message" }))
			.toBeVisible();
	});

	it("shows the first attachment thumbnail beside a queued prompt", async () => {
		const attachmentPreviewSrc = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
		const itemWithAttachment: QueueItemWithAttachmentPreview = {
			id: "queued-with-attachment",
			prompt: "Review this image",
			attachmentPreview: {
				name: "diagram.png",
				src: attachmentPreviewSrc,
			},
		};
		const queue: ExternalThreadQueueAdapter = {
			items: [itemWithAttachment, { id: "queued-without-attachment", prompt: "Then explain it" }],
			enqueue: vi.fn(),
			steer: vi.fn(),
			remove: vi.fn(),
			clear: vi.fn(),
		};

		const screen = renderExternalQueueThread(queue);
		const thumbnail = screen.getByRole("img", { name: "diagram.png attachment preview" });

		await expect.element(thumbnail).toBeVisible();
		await expect.element(thumbnail).toHaveAttribute("src", attachmentPreviewSrc);
		expect(screen.getByTestId("kilo-composer-queue-attachment").elements()).toHaveLength(1);
	});

	it("does not steer a queued prompt while connecting", async () => {
		const queue: ExternalThreadQueueAdapter = {
			items: [{ id: "queued", prompt: "Wait for this" }],
			enqueue: vi.fn(),
			steer: vi.fn(),
			remove: vi.fn(),
			clear: vi.fn(),
		};
		const connectionPromise = new Promise<KiloGlobalConnection>(() => undefined);
		const screen = renderExternalQueueThread(queue, {
			isRunning: false,
			connectionStatus: {
				isPending: true,
				isError: false,
				error: null,
				connectionPromise,
			},
		});
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start when connected");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.element(screen.getByTestId("kilo-composer-connecting")).toBeVisible();
		await input.fill("");
		input.element().focus();
		await userEvent.keyboard("{Enter}");

		expect(queue.steer).not.toHaveBeenCalled();
	});

	it("collapses and deletes queued prompts", async () => {
		const adapter = createBlockingAdapter();
		const screen = renderThread({
			initialMessages: [],
			adapter,
			enableMessageQueue: true,
		});
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start the long task");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.poll(() => adapter.run.mock.calls.length).toBe(1);
		await input.fill("Delete this follow-up");
		await screen.getByRole("button", { name: "Add message to queue" }).click();

		await screen.getByTestId("kilo-composer-queue-toggle").click();
		await expect.element(screen.getByText("Delete this follow-up")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-composer-queue-toggle").click();
		await screen.getByRole("button", { name: "Delete queued message" }).click();

		await expect.element(screen.getByTestId("kilo-composer-queue")).not.toBeInTheDocument();
	});
});

describe("scroll on send", () => {
	const scrollbackMessages = (): readonly ThreadMessageLike[] =>
		Array.from({ length: 12 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: [
				{
					type: "text" as const,
					text: `Message ${index} ${"scrollback filler ".repeat(12)}`,
				},
			],
		}));

	const getViewport = () => {
		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
		if (!viewport) throw new Error("Thread viewport was not rendered");
		return viewport;
	};

	const distanceFromBottom = (viewport: HTMLElement) =>
		viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

	it("scrolls to the bottom when the user sends a message", async () => {
		const screen = renderThread({ initialMessages: scrollbackMessages() });
		const viewport = getViewport();

		await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
		await expect.poll(() => distanceFromBottom(viewport)).toBeLessThan(2);

		viewport.scrollTo({ top: 0, behavior: "instant" });
		await expect.poll(() => viewport.scrollTop).toBe(0);

		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("Bring me to the latest message");
		await userEvent.type(input, "{Enter}");

		await expect.poll(() => distanceFromBottom(viewport), { timeout: 3000 }).toBeLessThan(2);
	});

	it("does not scroll when a queued message sends automatically", async () => {
		let releaseFirstRun!: () => void;
		const firstRunGate = new Promise<void>((resolve) => {
			releaseFirstRun = resolve;
		});
		const run = vi.fn(async () => {
			await firstRunGate;
			return { content: [{ type: "text" as const, text: "done" }] };
		});
		const screen = renderThread({
			initialMessages: scrollbackMessages(),
			adapter: { run },
			enableMessageQueue: true,
		});
		const viewport = getViewport();
		const input = screen.getByRole("textbox", { name: "Message input" });

		await input.fill("Start the long task");
		await userEvent.type(input, "{Enter}");
		await expect.poll(() => run.mock.calls.length).toBe(1);

		await input.fill("Queue this follow-up");
		await userEvent.type(input, "{Enter}");
		await expect.element(screen.getByText("1 queued")).toBeVisible();

		// Settle the send-triggered scroll, then scroll up to read history.
		await expect.poll(() => distanceFromBottom(viewport), { timeout: 3000 }).toBeLessThan(2);
		viewport.scrollTo({ top: 0, behavior: "instant" });
		await expect.poll(() => viewport.scrollTop).toBe(0);

		releaseFirstRun();
		await expect.poll(() => run.mock.calls.length).toBe(2);
		await expect.element(screen.getByTestId("kilo-composer-queue")).not.toBeInTheDocument();

		expect(viewport.scrollTop).toBeLessThan(2);
		expect(distanceFromBottom(viewport)).toBeGreaterThan(viewport.clientHeight);
	});
});

function CompletingSignIn() {
	const [authenticated, setAuthenticated] = useState(false);
	const auth: KiloAuthContextValue = {
		...signedOutAuth,
		authenticated,
		login: () => {
			setAuthenticated(true);
		},
	};
	return <ThreadTree auth={auth} initialMessages={signInErrorMessages()} />;
}

describe("message error sign-in", () => {
	it("adds a Sign in button on the error banner for a Kilo model while signed out", async () => {
		const login = vi.fn();
		const screen = renderThread({
			auth: { ...signedOutAuth, login },
			initialMessages: signInErrorMessages(),
		});

		await expect
			.element(screen.getByText("You need to connect to Kilo to use this model"))
			.toBeVisible();
		const button = screen.getByTestId("kilo-message-error-signin");
		await expect.element(button).toBeVisible();
		await expect.element(button).toHaveTextContent("Connect");

		await button.click();
		expect(login).toHaveBeenCalledOnce();
	});

	it("replaces the error banner with a signed-in notice after Sign in completes", async () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
		kiloUiBrowserRegister(mainSdk);
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<WorkspacesFeatureProvider>
						<CompletingSignIn />
					</WorkspacesFeatureProvider>
				</QueryClientProvider>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("You need to connect to Kilo to use this model"))
			.toBeVisible();
		await screen.getByTestId("kilo-message-error-signin").click();

		await expect.element(screen.getByTestId("kilo-message-error-signed-in")).toBeVisible();
		await expect.element(screen.getByText(/signed in to Kilo/)).toBeVisible();
		await expect
			.element(screen.getByText("You need to connect to Kilo to use this model"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-message-error-signin")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-message-error-retry")).toBeVisible();
	});

	it("shows the signed-in notice when the sign-in error is still on a signed-in session", async () => {
		const screen = renderThread({ initialMessages: signInErrorMessages() });

		await expect.element(screen.getByTestId("kilo-message-error-signed-in")).toBeVisible();
		await expect.element(screen.getByText(/signed in to Kilo/)).toBeVisible();
		await expect.element(screen.getByTestId("kilo-message-error-signin")).not.toBeInTheDocument();
	});

	it("resubmits the previous user prompt when Retry is clicked", async () => {
		const run = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "retried" }],
		}));
		const screen = renderThread({
			initialMessages: signInErrorMessages(),
			adapter: { run },
		});

		await expect.element(screen.getByTestId("kilo-message-error-retry")).toBeVisible();
		await screen.getByTestId("kilo-message-error-retry").click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
		await expect.element(screen.getByText("retried")).toBeVisible();
	});

	it("retries the failed turn in place through the previous user message id", async () => {
		const run = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "retried" }],
		}));
		const screen = renderThread({
			initialMessages: signInErrorMessages(),
			adapter: { run },
			extras: makeExtras({ id: "ses_1", directory: "/tmp/project" }),
		});

		await expect.element(screen.getByTestId("kilo-message-error-retry")).toBeVisible();
		await screen.getByTestId("kilo-message-error-retry").click();

		const lastUserId = document.querySelector<HTMLOutputElement>(
			'[data-qa-id="last-user-id"]',
		)?.textContent;
		await expect
			.poll(() => retryFailedTurn.mock.calls)
			.toEqual([
				[
					{
						connection,
						sessionID: "ses_1",
						directory: "/tmp/project",
						messageID: lastUserId,
						model: { providerID: "kilo", modelID: "test-model" },
					},
				],
			]);
		expect(run).not.toHaveBeenCalled();
	});

	it("unwraps a Gateway JSON dump into the tidy sign-in banner", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: signInErrorMessages(gatewayAuthDump),
		});

		await expect
			.element(screen.getByText("You need to connect to Kilo to use this model"))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-message-error-signin")).toBeVisible();
		await expect.element(screen.getByText(/PAID_MODEL_AUTH_REQUIRED/)).not.toBeInTheDocument();
		await expect.element(screen.getByText(/Unauthorized:/)).not.toBeInTheDocument();
	});

	it("does not add a Sign in button for a non-Kilo model", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			selection: anthropicModelSelection,
			initialMessages: signInErrorMessages(),
		});

		await expect
			.element(screen.getByText("You need to connect to Kilo to use this model"))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-message-error-signin")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-message-error-signed-in"))
			.not.toBeInTheDocument();
	});
});

function refusedToolCallMessages(
	result: string,
	toolName = "desktop_environments_conda_envs_list",
): readonly ThreadMessageLike[] {
	return [
		{ role: "user", content: [{ type: "text", text: "List my environments" }] },
		{
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId:
						toolName === "desktop_environments_conda_envs_list" ? "call-conda" : `call-${toolName}`,
					toolName,
					args: {},
					result,
					isError: true,
				},
				{ type: "text", text: "I'll wait for you to sign in." },
			],
		},
	];
}

/** Stands in for kilo-server's main-owned sign-in gating state. */
function fakeAgentToolSignIn(initial: AgentToolSignInState = { declined: [] }) {
	let state = initial;
	const listeners = new Set<(state: AgentToolSignInState) => void>();
	return {
		getState: async () => state,
		decline: vi.fn(async (scope: string) => {
			state = { declined: [...state.declined, scope] };
			for (const listener of [...listeners]) listener(state);
			return state;
		}),
		subscribe: (listener: (state: AgentToolSignInState) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** Main forgets the decline, as it does when the user signs in. */
		forgetDecline() {
			state = { declined: [] };
			for (const listener of [...listeners]) listener(state);
		},
	} satisfies AgentToolSignInCapability & { forgetDecline(): void };
}

const ENV_SIGN_IN_PROMPT = {
	title: "Use governed packages for environments?",
	body: "The agent wants the environment tools. Sign in to a Kilo account?",
	toolsLabel: "the environment tools",
};

/** The refused tool as the environments plugin registers it, with its own prompt. */
const envsListTool: ToolDefinition = {
	name: "conda.envs.list",
	description: "List environments",
	exposeToModelContext: true,
	requiresSignIn: ENV_SIGN_IN_PROMPT,
	handler: () => [],
};

const NOTEBOOK_SIGN_IN_PROMPT = {
	title: "Sign in to use embedded notebooks?",
	body: "The agent wants the notebook tools. Sign in to a Kilo account?",
	toolsLabel: "the notebook tools",
};

const notebookOpenTool: ToolDefinition = {
	name: "open",
	description: "Open a notebook",
	exposeToModelContext: true,
	requiresSignIn: NOTEBOOK_SIGN_IN_PROMPT,
	handler: () => ({}),
};

describe("tool sign-in prompt", () => {
	const required = signInRequiredToolMessage("kilo");

	afterEach(() => {
		localStorage.clear();
	});
	const continued = () => vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));

	it("asks a signed-out user to sign in where the refused tool call was", async () => {
		const login = vi.fn();
		const screen = renderThread({
			auth: { ...signedOutAuth, login },
			initialMessages: refusedToolCallMessages(required),
			agentToolSignIn: fakeAgentToolSignIn(),
			environmentsTools: [envsListTool],
		});

		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).toBeVisible();
		await expect.element(screen.getByText(ENV_SIGN_IN_PROMPT.title)).toBeVisible();
		await expect.element(screen.getByText(ENV_SIGN_IN_PROMPT.body)).toBeVisible();
		await expect.element(screen.getByText(/desktop:sign-in-required/)).not.toBeInTheDocument();

		await screen.getByTestId("kilo-tool-signin-prompt-signin").click();
		expect(login).toHaveBeenCalledOnce();
	});

	it("falls back to neutral wording when the tool supplies no prompt", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required),
			agentToolSignIn: fakeAgentToolSignIn(),
			environmentsTools: [{ ...envsListTool, requiresSignIn: true }],
		});

		await expect.element(screen.getByText("Sign in to let the agent use this tool?")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"This Desktop tool needs you to be signed in to a Kilo account. Do you want to sign in?",
				),
			)
			.toBeVisible();
	});

	it("continues the task automatically once the user signs in from the prompt", async () => {
		const run = continued();
		const authControl: AuthControl = {};
		const screen = renderThread({
			auth: { ...signedOutAuth, login: () => authControl.set?.(signedInAuth) },
			authControl,
			initialMessages: refusedToolCallMessages(required),
			adapter: { run },
			agentToolSignIn: fakeAgentToolSignIn(),
		});

		await screen.getByTestId("kilo-tool-signin-prompt-signin").click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
		await expect.element(screen.getByText("I've signed in. Please continue.")).toBeVisible();
	});

	it("waits for sign-in to finish before continuing, so the turn uses the signed-in model", async () => {
		// Sign-in flips to authenticated before it refreshes the model catalog; a
		// turn sent then still carries the signed-out model and fails.
		const run = continued();
		const authControl: AuthControl = {};
		const screen = renderThread({
			auth: signedOutAuth,
			authControl,
			initialMessages: refusedToolCallMessages(required),
			adapter: { run },
			agentToolSignIn: fakeAgentToolSignIn(),
		});
		await screen.getByTestId("kilo-tool-signin-prompt-signin").click();

		authControl.set?.({ ...signedInAuth, deviceAuth: { status: "finishing" } });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(run).not.toHaveBeenCalled();

		authControl.set?.(signedInAuth);
		await expect.poll(() => run.mock.calls.length).toBe(1);
	});

	it("does not continue while the model catalog is still refreshing", async () => {
		const run = continued();
		const authControl: AuthControl = {};
		const screen = renderThread({
			auth: { ...signedOutAuth, login: () => authControl.set?.(signedInAuth) },
			authControl,
			selection: { ...kiloModelSelection, isCatalogFetching: true },
			initialMessages: refusedToolCallMessages(required),
			adapter: { run },
			agentToolSignIn: fakeAgentToolSignIn(),
		});

		await screen.getByTestId("kilo-tool-signin-prompt-signin").click();
		await expect.element(screen.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(run).not.toHaveBeenCalled();
		await expect.element(screen.getByTestId("kilo-tool-signin-continue")).not.toBeInTheDocument();
	});

	it("records a decline and continues the task without the tools", async () => {
		const run = continued();
		const signIn = fakeAgentToolSignIn();
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required),
			adapter: { run },
			agentToolSignIn: signIn,
			environmentsTools: [envsListTool],
		});

		await screen.getByTestId("kilo-tool-signin-prompt-decline").click();

		expect(signIn.decline).toHaveBeenCalledExactlyOnceWith("environments");
		await expect.poll(() => run.mock.calls.length).toBe(1);
		await expect
			.element(
				screen.getByText(
					"I'd rather not sign in for now. Please continue without the environment tools.",
				),
			)
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-declined")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).not.toBeInTheDocument();
	});

	describe("after a decline", () => {
		afterEach(() => {
			tellAgentToolsAvailable.mockClear();
		});

		function renderDeclinedCall(auth: KiloAuthContextValue) {
			return renderThread({
				auth,
				extras: makeExtras({ id: "ses_1", directory: "/workspace/project" }),
				initialMessages: refusedToolCallMessages(SIGN_IN_DECLINED_TOOL_MESSAGE),
				agentToolSignIn: fakeAgentToolSignIn(),
				environmentsTools: [envsListTool],
			});
		}

		it("tells the agent the tools are back once the user is signed in, once", async () => {
			const screen = renderDeclinedCall(signedInAuth);

			await expect
				.poll(() => tellAgentToolsAvailable.mock.calls)
				.toEqual([
					[
						{
							connection,
							sessionID: "ses_1",
							directory: "/workspace/project",
							toolsLabel: "the environment tools",
						},
					],
				]);
			await expect.element(screen.getByTestId("kilo-tool-signin-declined-signed-in")).toBeVisible();
			cleanup();
			renderDeclinedCall(signedInAuth);
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(tellAgentToolsAvailable).toHaveBeenCalledOnce();
		});

		it("tells the agent the tools are back when the user declines in this chat, then signs in", async () => {
			const signIn = fakeAgentToolSignIn();
			const authControl: AuthControl = {};
			const screen = renderThread({
				auth: signedOutAuth,
				authControl,
				extras: makeExtras({ id: "ses_1", directory: "/workspace/project" }),
				initialMessages: refusedToolCallMessages(required),
				agentToolSignIn: signIn,
				environmentsTools: [envsListTool],
			});
			await screen.getByTestId("kilo-tool-signin-prompt-decline").click();
			await expect.element(screen.getByTestId("kilo-tool-signin-declined")).toBeVisible();

			signIn.forgetDecline();
			authControl.set?.(signedInAuth);

			await expect.poll(() => tellAgentToolsAvailable.mock.calls.length).toBe(1);
			expect(tellAgentToolsAvailable.mock.calls[0]?.[0]).toMatchObject({ sessionID: "ses_1" });
			await expect.element(screen.getByTestId("kilo-tool-signin-declined-signed-in")).toBeVisible();
		});

		it("does not tell the agent anything while the user is still signed out", async () => {
			const screen = renderDeclinedCall(signedOutAuth);

			await expect.element(screen.getByTestId("kilo-tool-signin-declined")).toBeVisible();
			expect(tellAgentToolsAvailable).not.toHaveBeenCalled();
		});
	});

	it("declines only the refused tool's feature, so another feature's tools still ask", async () => {
		const signIn = fakeAgentToolSignIn();
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required, "desktop_notebook_open"),
			agentToolSignIn: signIn,
			notebookTools: [notebookOpenTool],
		});

		await expect.element(screen.getByText(NOTEBOOK_SIGN_IN_PROMPT.title)).toBeVisible();
		await screen.getByTestId("kilo-tool-signin-prompt-decline").click();

		expect(signIn.decline).toHaveBeenCalledExactlyOnceWith("notebook");
		cleanup();
		const environments = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required),
			agentToolSignIn: signIn,
			environmentsTools: [envsListTool],
		});
		await expect.element(environments.getByTestId("kilo-tool-signin-prompt")).toBeVisible();
		await expect
			.element(environments.getByTestId("kilo-tool-signin-declined"))
			.not.toBeInTheDocument();
	});

	it("does not ask again on a refused call once the user has declined", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required),
			agentToolSignIn: fakeAgentToolSignIn({ declined: ["environments"] }),
		});

		await expect.element(screen.getByTestId("kilo-tool-signin-declined")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).not.toBeInTheDocument();
	});

	it("notes that the tools are off when a call was refused after a decline", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(SIGN_IN_DECLINED_TOOL_MESSAGE),
			agentToolSignIn: fakeAgentToolSignIn({ declined: ["environments"] }),
			environmentsTools: [envsListTool],
		});

		await expect.element(screen.getByTestId("kilo-tool-signin-declined")).toBeVisible();
		await expect
			.element(screen.getByText(/so the agent won.t use the environment tools until you do\./))
			.toBeVisible();
		await expect.element(screen.getByText(/desktop:sign-in-declined/)).not.toBeInTheDocument();
	});

	it("asks the agent to switch back to the tools once a declined user signs in", async () => {
		const run = continued();
		const screen = renderThread({
			initialMessages: refusedToolCallMessages(SIGN_IN_DECLINED_TOOL_MESSAGE),
			adapter: { run },
			agentToolSignIn: fakeAgentToolSignIn(),
			environmentsTools: [envsListTool],
		});

		await expect
			.element(screen.getByText(/signed in\. The agent can use the environment tools again\./))
			.toBeVisible();
		await screen.getByTestId("kilo-tool-signin-use-tools").click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
		await expect
			.element(screen.getByText(/please use the environment tools again instead of/))
			.toBeVisible();
	});

	it("lets the user continue a refused call they have since signed in for", async () => {
		const run = continued();
		const screen = renderThread({
			initialMessages: refusedToolCallMessages(required),
			adapter: { run },
			agentToolSignIn: fakeAgentToolSignIn(),
		});

		await expect.element(screen.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await screen.getByTestId("kilo-tool-signin-continue").click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
	});

	it("renders other tools normally even when their output mentions the sign-in marker", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: [
				{ role: "user", content: [{ type: "text", text: "Grep the repo" }] },
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "call-bash",
							toolName: "bash",
							args: { command: "rg sign-in-required" },
							result: `sign-in-required.ts: ${required}`,
						},
						{ type: "text", text: "Found it." },
					],
				},
			],
			agentToolSignIn: fakeAgentToolSignIn(),
		});

		await expect.element(screen.getByText("Found it.")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-tool-signin-signed-in")).not.toBeInTheDocument();
	});

	it("does not offer sign-in for a Desktop tool that does not require it, even if its error carries the marker", async () => {
		// A tool's own error can echo input containing the marker; only the
		// gateway refuses registered sign-in tools, and "Not now" changes a global gate.
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages(required),
			agentToolSignIn: fakeAgentToolSignIn(),
			environmentsTools: [{ ...envsListTool, requiresSignIn: false }],
		});

		await expect.element(screen.getByText("I'll wait for you to sign in.")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-tool-signin-prompt-decline"))
			.not.toBeInTheDocument();
	});

	it("does not prompt for sign-in on an ordinary tool error", async () => {
		const screen = renderThread({
			auth: signedOutAuth,
			initialMessages: refusedToolCallMessages("ENV_EXISTS: environment already exists"),
			agentToolSignIn: fakeAgentToolSignIn(),
		});

		await expect.element(screen.getByText("I'll wait for you to sign in.")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-tool-signin-prompt")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-tool-signin-declined")).not.toBeInTheDocument();
	});
});

describe("snapshot progress status", () => {
	const progressPartMessages = (
		status: "running" | "complete",
	): readonly ExternalThreadMessage[] => [
		fromThreadMessageLike(
			{ role: "user", content: [{ type: "text", text: "Set up my project" }] },
			"msg-user",
			{ type: "complete", reason: "stop" },
		),
		fromThreadMessageLike(
			{
				role: "assistant",
				status: status === "running" ? { type: "running" } : { type: "complete", reason: "stop" },
				content: [
					{
						type: "data",
						name: "opencode-snapshot-progress",
						data: { text: "⠋ Initializing snapshot…" },
					},
				],
			},
			"msg-assistant",
			{ type: "complete", reason: "stop" },
		),
	];

	it("shows 'Initializing snapshot…' as the working status instead of chat text", async () => {
		const screen = renderExternalMessagesThread(progressPartMessages("running"), true);

		await expect
			.element(screen.getByRole("status", { name: "Initializing snapshot…" }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("status", { name: "Considering next steps" }))
			.not.toBeInTheDocument();
		// The raw spinner-frame text must never land in the chat content.
		expect(screen.getByText(/⠋ Initializing snapshot…/).elements()).toHaveLength(0);
	});

	it("leaves no trace of the progress part once the message completes", async () => {
		const screen = renderExternalMessagesThread(progressPartMessages("complete"), false);

		await expect
			.element(screen.getByRole("status", { name: "Initializing snapshot…" }))
			.not.toBeInTheDocument();
		expect(screen.getByText(/⠋ Initializing snapshot…/).elements()).toHaveLength(0);
	});
});

describe("assistant working status", () => {
	const idleRunningMessages = (): readonly ExternalThreadMessage[] => [
		fromThreadMessageLike(
			{ role: "user", content: [{ type: "text", text: "Inspect the workspace" }] },
			"msg-user",
			{ type: "complete", reason: "stop" },
		),
		fromThreadMessageLike(
			{ role: "assistant", status: { type: "running" }, content: [] },
			"msg-assistant",
			{ type: "complete", reason: "stop" },
		),
	];

	it("waits through transient activity gaps before showing considering next steps", async () => {
		vi.useFakeTimers();
		renderExternalMessagesThread(idleRunningMessages(), true);
		const indicator = () =>
			document.querySelector('[role="status"][aria-label="Considering next steps"]');
		const reservedSpace = document.querySelector('[data-slot="aui_assistant-message-indicator"]');
		const reservedHeight = reservedSpace?.getBoundingClientRect().height;

		await act(async () => {
			await vi.advanceTimersByTimeAsync(749);
		});
		expect(indicator()).toBeNull();
		expect(reservedSpace).not.toBeNull();
		expect(reservedSpace).toHaveAttribute("aria-hidden", "true");
		expect(reservedHeight).toBeGreaterThan(0);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(indicator()).not.toBeNull();
		expect(indicator()?.getBoundingClientRect().height).toBe(reservedHeight);
	});

	it("shows the top-level working timer without replacing considering next steps", async () => {
		vi.useFakeTimers();
		const screen = renderExternalMessagesThread(idleRunningMessages(), true);

		await expect.element(screen.getByTestId("kilo-turn-working")).toBeVisible();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(750);
		});
		await expect
			.element(screen.getByRole("status", { name: "Considering next steps" }))
			.toBeVisible();
	});

	it("shows considering next steps after an assistant progress update", async () => {
		vi.useFakeTimers();
		const messages: readonly ExternalThreadMessage[] = [
			idleRunningMessages()[0]!,
			fromThreadMessageLike(
				{
					role: "assistant",
					status: { type: "running" },
					content: [{ type: "text", text: "I inspected the sidebar changes." }],
				},
				"msg-assistant",
				{ type: "complete", reason: "stop" },
			),
		];
		const screen = renderExternalMessagesThread(messages, true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(750);
		});
		await expect
			.element(screen.getByRole("status", { name: "Considering next steps" }))
			.toBeVisible();
	});

	it("hides considering next steps while a plan waits for approval", async () => {
		vi.useFakeTimers();
		pendingQuestionsRef.current = [
			{
				id: "q-plan",
				sessionID: "session-1",
				askedAt: 1,
				questions: [
					{
						question: "Ready to implement?",
						header: "Implement",
						options: [
							{ label: "Continue here", description: "" },
							{ label: "Keep refining", description: "" },
						],
					},
				],
			},
		];
		const messages: readonly ExternalThreadMessage[] = [
			idleRunningMessages()[0]!,
			fromThreadMessageLike(
				{
					role: "assistant",
					status: { type: "running" },
					content: [{ type: "text", text: "Here is the plan." }],
				},
				"msg-assistant",
				{ type: "complete", reason: "stop" },
			),
		];
		renderExternalMessagesThread(messages, true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(
			document.querySelector('[role="status"][aria-label="Considering next steps"]'),
		).toBeNull();
	});

	const runningTextMessages = (textTime: {
		start: number;
		end?: number;
	}): readonly ExternalThreadMessage[] => [
		idleRunningMessages()[0]!,
		fromThreadMessageLike(
			{
				role: "assistant",
				status: { type: "running" },
				content: [{ type: "text", text: "Streaming the answer" }],
				metadata: {
					custom: {
						opencode: {
							parts: [{ type: "text", text: "Streaming the answer", time: textTime }],
						},
					},
				},
			},
			"msg-assistant",
			{ type: "complete", reason: "stop" },
		),
	];
	const consideringIndicator = () =>
		document.querySelector('[role="status"][aria-label="Considering next steps"]');

	it("hides considering next steps while reply text is still streaming", async () => {
		vi.useFakeTimers();
		renderExternalMessagesThread(runningTextMessages({ start: 1 }), true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(consideringIndicator()).toBeNull();
	});

	it("shows considering next steps once reply text has finished streaming", async () => {
		vi.useFakeTimers();
		renderExternalMessagesThread(runningTextMessages({ start: 1, end: 2 }), true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(consideringIndicator()).not.toBeNull();
	});

	it("hides considering next steps while subagents are still working", async () => {
		vi.useFakeTimers();
		subagentsRef.active = true;
		renderExternalMessagesThread(idleRunningMessages(), true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(consideringIndicator()).toBeNull();
	});

	it("collapses completed work while leaving the final answer visible", async () => {
		const messages: readonly ExternalThreadMessage[] = [
			fromThreadMessageLike(
				{
					role: "user",
					createdAt: new Date(Date.now() - 2_000),
					content: [{ type: "text", text: "Inspect the workspace" }],
				},
				"msg-user",
				{ type: "complete", reason: "stop" },
			),
			fromThreadMessageLike(
				{
					role: "assistant",
					status: { type: "complete", reason: "stop" },
					content: [
						{ type: "reasoning", text: "I should inspect the files first." },
						{ type: "text", text: "The workspace is ready." },
					],
				},
				"msg-assistant",
				{ type: "complete", reason: "stop" },
			),
		];
		const screen = renderExternalMessagesThread(messages, false);

		await expect.element(screen.getByText("The workspace is ready.")).toBeVisible();
		await expect
			.element(screen.getByText("I should inspect the files first."))
			.not.toBeInTheDocument();
		const toggle = screen.getByTestId("kilo-turn-work-toggle");
		await expect.poll(() => toggle.element().textContent).toMatch(/^Worked for /);

		await toggle.click();
		await screen.getByRole("button", { name: "Thought" }).click();
		await expect.element(screen.getByText("I should inspect the files first.")).toBeVisible();
	});

	it("collapses the work fold when a running turn ends", async () => {
		const user = fromThreadMessageLike(
			{
				role: "user",
				createdAt: new Date(Date.now() - 2_000),
				content: [{ type: "text", text: "Inspect the workspace" }],
			},
			"msg-user",
			{ type: "complete", reason: "stop" },
		);
		const assistant = (status: { type: "running" } | { type: "complete"; reason: "stop" }) =>
			fromThreadMessageLike(
				{
					role: "assistant",
					status,
					content: [
						{ type: "reasoning", text: "I should inspect the files first." },
						{ type: "text", text: "The workspace is ready." },
					],
				},
				"msg-assistant",
				status,
			);
		const screen = renderExternalMessagesThread([user, assistant({ type: "running" })], true);
		await expect.element(screen.getByTestId("kilo-turn-working")).toBeVisible();

		screen.update([user, assistant({ type: "complete", reason: "stop" })], false);

		const toggle = screen.getByTestId("kilo-turn-work-toggle");
		await expect.poll(() => toggle.element().textContent).toMatch(/^Worked for /);
		await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("The workspace is ready.")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Thought" })).not.toBeInTheDocument();
	});

	it("keeps the work fold open when a delegation reveal lands as the turn ends", async () => {
		const user = fromThreadMessageLike(
			{
				role: "user",
				createdAt: new Date(Date.now() - 2_000),
				content: [{ type: "text", text: "Map the auth flow" }],
			},
			"msg-user",
			{ type: "complete", reason: "stop" },
		);
		const assistant = (status: { type: "running" } | { type: "complete"; reason: "stop" }) =>
			fromThreadMessageLike(
				{
					role: "assistant",
					status,
					content: [
						{
							type: "tool-call",
							toolCallId: "call-task",
							toolName: "task",
							args: { description: "Trace the login", subagent_type: "explore" },
							result: "Done",
						},
						{ type: "text", text: "The auth flow is mapped." },
					],
				},
				"msg-assistant",
				status,
			);
		const screen = renderExternalMessagesThread([user, assistant({ type: "running" })], true);
		await expect.element(screen.getByTestId("kilo-turn-working")).toBeVisible();

		act(() => {
			useDelegationRevealStore.getState().reveal("call-task");
			screen.update([user, assistant({ type: "complete", reason: "stop" })], false);
		});

		const toggle = screen.getByTestId("kilo-turn-work-toggle");
		await expect.poll(() => toggle.element().textContent).toMatch(/^Worked for /);
		// Let the end-of-turn collapse frame run before checking the fold.
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
	});

	it("says a text-only reply was stopped when there is no work fold to say it", async () => {
		const status = { type: "incomplete", reason: "cancelled" } as const;
		const messages: readonly ExternalThreadMessage[] = [
			fromThreadMessageLike(
				{
					role: "user",
					createdAt: new Date(Date.now() - 2_000),
					content: [{ type: "text", text: "Write an essay" }],
				},
				"msg-user",
				{ type: "complete", reason: "stop" },
			),
			fromThreadMessageLike(
				{ role: "assistant", status, content: [{ type: "text", text: "Once upon" }] },
				"msg-assistant",
				status,
			),
		];
		const screen = renderExternalMessagesThread(messages, false);

		await expect.element(screen.getByText("Once upon")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-turn-work-toggle")).not.toBeInTheDocument();
		await expect
			.poll(() => screen.getByTestId("kilo-turn-stopped").element().textContent)
			.toMatch(/^You stopped/);
	});

	it("leaves the stop to the work fold when the turn has one", async () => {
		const status = { type: "incomplete", reason: "cancelled" } as const;
		const messages: readonly ExternalThreadMessage[] = [
			fromThreadMessageLike(
				{
					role: "user",
					createdAt: new Date(Date.now() - 2_000),
					content: [{ type: "text", text: "Inspect the workspace" }],
				},
				"msg-user",
				{ type: "complete", reason: "stop" },
			),
			fromThreadMessageLike(
				{
					role: "assistant",
					status,
					content: [
						{ type: "reasoning", text: "I should inspect the files first." },
						{ type: "text", text: "Partial answer" },
					],
				},
				"msg-assistant",
				status,
			),
		];
		const screen = renderExternalMessagesThread(messages, false);

		const toggle = screen.getByTestId("kilo-turn-work-toggle");
		await expect.poll(() => toggle.element().textContent).toMatch(/^You stopped/);
		await expect.element(screen.getByTestId("kilo-turn-stopped")).not.toBeInTheDocument();
	});
});
