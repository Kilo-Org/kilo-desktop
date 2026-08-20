import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

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
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
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
}: {
	auth: KiloAuthContextValue;
	selection?: typeof kiloModelSelection | typeof anthropicModelSelection;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
}) {
	const runtime = useLocalRuntime(adapter, { initialMessages });
	return (
		<KiloAuthContext.Provider value={auth}>
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
}: {
	auth?: KiloAuthContextValue;
	selection?: typeof kiloModelSelection | typeof anthropicModelSelection;
	initialMessages: readonly ThreadMessageLike[];
	adapter?: ChatModelAdapter;
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
						{...(adapter ? { adapter } : {})}
					/>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

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
