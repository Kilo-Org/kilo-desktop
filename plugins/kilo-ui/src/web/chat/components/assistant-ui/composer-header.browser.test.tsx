import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

const extrasRef = vi.hoisted(() => ({
	current: undefined as OpenCodeRuntimeExtras | undefined,
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => extrasRef.current,
	selectOpenCodeExtras: () => extrasRef.current,
}));

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

type RevertWorkspace = "restored" | "snapshots-disabled" | "unavailable" | "not-a-git-repo";

function makePendingRevertExtras(workspace: RevertWorkspace | null): OpenCodeRuntimeExtras {
	return {
		session: {
			id: "ses_1",
			revert: { messageID: "msg-2", ...(workspace ? { workspace } : {}) },
		} as never,
		state: {
			messageOrder: ["msg-2"],
			messagesById: { "msg-2": { id: "msg-2", info: { id: "msg-2", role: "user" }, parts: [] } },
		} as never,
		permissions: {},
		questions: {},
		fork: vi.fn(),
		revert: vi.fn().mockResolvedValue(undefined),
		unrevert: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn(),
		refresh: vi.fn(),
		replyToPermission: vi.fn(),
		replyToQuestion: vi.fn(),
		rejectQuestion: vi.fn(),
	};
}

function renderThread(
	options: {
		initialMessages?: readonly ThreadMessageLike[];
		pendingRevert?: boolean;
		revertWorkspace?: RevertWorkspace | null;
	} = {},
) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	kiloUiBrowserRegister(mainSdk);
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	extrasRef.current = options.pendingRevert
		? makePendingRevertExtras(options.revertWorkspace ?? null)
		: undefined;

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

afterEach(() => {
	cleanup();
	localStorage.clear();
	extrasRef.current = undefined;
});

describe("ComposerHeader", () => {
	it("stays hidden on a plain thread with messages, without the draft footer", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).not.toBeInTheDocument();
	});

	it("shows the header while a revert is pending", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			pendingRevert: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
		await expect.element(screen.getByText("1 message reverted")).toBeVisible();
	});

	it("omits the workspace notice while a revert is pending and the workspace was restored", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			pendingRevert: true,
			revertWorkspace: "restored",
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
	});

	it("does not show the snapshots-disabled notice inline when files were not restored", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			pendingRevert: true,
			revertWorkspace: "snapshots-disabled",
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Conversation reverted. File changes were not restored because snapshots are disabled.",
				),
			)
			.not.toBeInTheDocument();
	});

	it("does not show the unavailable notice inline when snapshot data is unavailable", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			pendingRevert: true,
			revertWorkspace: "unavailable",
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Conversation reverted. No file checkpoint was available, so workspace changes were not restored.",
				),
			)
			.not.toBeInTheDocument();
	});

	it("does not show the legacy notice inline when the revert predates workspace status", async () => {
		const { baseElement } = renderThread({
			initialMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			pendingRevert: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Conversation reverted. Workspace restoration status is unavailable for this earlier revert.",
				),
			)
			.not.toBeInTheDocument();
	});

	it("hides the header on an empty chat, leaving the draft footer visible", async () => {
		const { baseElement } = renderThread();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-header")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-composer-draft-footer")).toBeVisible();
	});
});
