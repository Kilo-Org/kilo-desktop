import {
	AssistantRuntimeProvider,
	InMemoryThreadListAdapter,
	ThreadListPrimitive,
	useAuiState,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { kiloUiBrowserRegister } from "../../../browserRegister.js";
import { OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { ChatConnectionProvider } from "../../connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { WorkspacesFeatureProvider } from "../../../workspaces/WorkspacesFeatureProvider.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
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

class FocusThreadListAdapter extends InMemoryThreadListAdapter {
	override async list() {
		return {
			threads: [{ remoteId: "existing-session", status: "regular" as const }],
		};
	}

	override async fetch(threadId: string) {
		return { remoteId: threadId, status: "regular" as const };
	}
}

const focusThreadListAdapter = new FocusThreadListAdapter();

function ActiveThreadStatus() {
	const status = useAuiState((state) => state.threadListItem.status);
	return <output data-qa-id="active-thread-status">{status}</output>;
}

function ThreadListFocusHarness() {
	const runtime = useRemoteThreadListRuntime({
		adapter: focusThreadListAdapter,
		initialThreadId: "existing-session",
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadListPrimitive.Root>
				<ThreadListPrimitive.New>New Chat</ThreadListPrimitive.New>
			</ThreadListPrimitive.Root>
			<ActiveThreadStatus />
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
					<ChatModelSelectionProvider value={modelSelection}>
						<div className="h-[480px]">
							<Thread />
						</div>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

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
				<ChatAgentSelectionProvider value={agentSelection}>
					<ChatModelSelectionProvider value={modelSelection}>
						<div className="h-[480px]">
							<Thread />
						</div>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
			</ChatConnectionProvider>
		</AssistantRuntimeProvider>
	);
}

function renderThread(
	options: {
		initialMessages?: readonly ThreadMessageLike[];
		shell?: Partial<SDK["shell"]>;
	} = {},
) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		...(options.shell === undefined ? {} : { shell: options.shell }),
	});
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadHarness
							{...(options.initialMessages === undefined
								? {}
								: { initialMessages: options.initialMessages })}
						/>
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

function renderThreadListFocusHarness() {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<KiloAuthContext.Provider value={signedInAuth}>
						<ThreadListFocusHarness />
					</KiloAuthContext.Provider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("ComposerDraftFooter", () => {
	it("focuses the composer after switching from a session to a new chat", async () => {
		const { baseElement } = renderThreadListFocusHarness();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("active-thread-status")).toHaveTextContent("regular");
		await screen.getByRole("button", { name: "New Chat" }).click();

		await expect.element(screen.getByTestId("active-thread-status")).toHaveTextContent("new");
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toHaveFocus();
	});

	it("shows the draft footer with the workspace selector on an empty chat", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).toBeVisible();
		await expect.element(screen.getByRole("combobox", { name: "Select workspace" })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Select agent" })).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
	});

	it("opens the model selector when the workspace selector was already open", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("combobox", { name: "Select workspace" }).click();
		await expect.element(screen.getByText("No workspaces yet.")).toBeVisible();

		await screen.getByRole("combobox", { name: "Select model" }).click();
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});

		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		await expect.element(screen.getByPlaceholder("Search models...")).toHaveFocus();
		await expect.element(screen.getByText("No workspaces yet.")).not.toBeInTheDocument();
	});

	it("hides the draft footer when the thread has messages", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole("combobox", { name: "Select workspace" }))
			.not.toBeInTheDocument();
	});
});
