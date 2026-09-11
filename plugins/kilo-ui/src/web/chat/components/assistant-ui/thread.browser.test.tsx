import {
	AuiProvider,
	AssistantRuntimeProvider,
	ExternalThread,
	fromThreadMessageLike,
	useAui,
	useLocalRuntime,
	type ChatModelAdapter,
	type ExternalThreadMessage,
	type ExternalThreadQueueAdapter,
	type QueueItemState,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import {
	ChatConnectionProvider,
	type ChatConnectionStatus,
} from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { Thread } from "./thread.js";

afterEach(() => {
	cleanup();
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
	model: { providerID: "anaconda-local", modelID: "qwen-3" },
	name: "Qwen 3",
	catalog: {
		providers: [{ id: "anaconda-local", name: "Local", connected: true }],
		models: [
			{
				id: "anaconda-local/qwen-3",
				name: "Qwen 3",
				providerID: "anaconda-local",
				modelID: "qwen-3",
			},
		],
		defaults: { "anaconda-local": "qwen-3" },
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
}: {
	auth: KiloAuthContextValue;
	selection?: ChatModelSelectionValue;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
	enableMessageQueue?: boolean;
	connectionStatus?: ChatConnectionStatus;
}) {
	const runtime = useLocalRuntime(adapter, {
		initialMessages,
		unstable_enableMessageQueue: enableMessageQueue,
	});
	return (
		<KiloAuthContext.Provider value={auth}>
			<AssistantRuntimeProvider runtime={runtime}>
				<ChatConnectionProvider status={connectionStatus}>
					<ChatAgentSelectionProvider value={agentSelection}>
						<ChatModelSelectionProvider value={selection}>
							<div className="h-[480px]">
								<Thread />
							</div>
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
}: {
	auth?: KiloAuthContextValue;
	selection?: ChatModelSelectionValue;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
	enableMessageQueue?: boolean;
	connectionStatus?: ChatConnectionStatus;
}) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ThreadTree
						auth={auth}
						selection={selection}
						initialMessages={initialMessages}
						{...(enableMessageQueue === undefined ? {} : { enableMessageQueue })}
						{...(adapter ? { adapter } : {})}
						{...(connectionStatus ? { connectionStatus } : {})}
					/>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

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

function ExternalQueueThreadTree({ queue }: { queue: ExternalThreadQueueAdapter }) {
	const aui = useAui({
		thread: ExternalThread({ messages: [], isRunning: true, queue }),
	});

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

function renderExternalQueueThread(queue: ExternalThreadQueueAdapter) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ExternalQueueThreadTree queue={queue} />
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
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ExternalMessagesThreadTree messages={messages} isRunning={isRunning} />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

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
		await expect.element(input).toHaveValue("Hello from the composer");
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

	it("shows 'Initializing snapshot...' as the working status instead of chat text", async () => {
		const screen = renderExternalMessagesThread(progressPartMessages("running"), true);

		await expect
			.element(screen.getByRole("status", { name: "Initializing snapshot..." }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("status", { name: "Considering next steps" }))
			.not.toBeInTheDocument();
		// The raw spinner-frame text must never land in the chat content.
		expect(screen.getByText(/Initializing snapshot…/).elements()).toHaveLength(0);
	});

	it("leaves no trace of the progress part once the message completes", async () => {
		const screen = renderExternalMessagesThread(progressPartMessages("complete"), false);

		await expect
			.element(screen.getByRole("status", { name: "Initializing snapshot..." }))
			.not.toBeInTheDocument();
		expect(screen.getByText(/Initializing snapshot…/).elements()).toHaveLength(0);
	});
});
