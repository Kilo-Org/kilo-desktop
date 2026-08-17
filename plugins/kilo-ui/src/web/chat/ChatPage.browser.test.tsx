import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook } from "@testing-library/react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider, useFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";
import {
	FeatureError,
	HEADER_LEADING_ZONE,
	HEADER_TRAILING_ZONE,
	type Contribution,
} from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type * as AssistantUiReact from "@assistant-ui/react";

import {
	kiloUiChatContract,
	type KiloUiChatService,
	type KiloGlobalConnection,
} from "../../contracts/chat/schemas.js";
import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { WorkspacesFeatureProvider } from "../workspaces/WorkspacesFeatureProvider.js";
import {
	ChatConnectionProvider,
	type ChatConnectionStatus,
	useChatConnection,
} from "./connection/ChatConnectionContext.js";
import { ChatFeatureProvider } from "./ChatFeatureProvider.js";
import { ChatPage } from "./ChatPage.js";
import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import {
	CHAT_RIGHT_PANEL_TAB_EXTENSION,
	type ChatRightPanelContributionProps,
} from "./right-panel/right-panel-tab-registry.js";
import { chatRightPanelCapability } from "./right-panel/chat-right-panel-capability.js";
import { useRightPanelStore } from "./right-panel/right-panel-store.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { useKiloModelCatalog } from "./model-selection/use-kilo-model-catalog.js";
import { useKiloAgentCatalog } from "./agent-selection/use-kilo-agent-catalog.js";
import { useChatAgentSelection } from "./agent-selection/ChatAgentSelectionContext.js";
import { HammerIcon, ListTodoIcon } from "lucide-react";

/** Stand-in for a shell ZoneOutlet so page contributions render in tests. */
function ZoneOutletStandIn({
	zone,
	qaId,
}: {
	zone: typeof HEADER_LEADING_ZONE | typeof HEADER_TRAILING_ZONE;
	qaId: string;
}) {
	const registry = useFeatureSystem().services.contributionRegistry;
	const [contributions, setContributions] = useState<readonly Contribution[]>(() =>
		registry.getForZone(zone),
	);

	useEffect(() => {
		setContributions(registry.getForZone(zone));
		return registry.onChange(() => {
			setContributions(registry.getForZone(zone));
		});
	}, [registry, zone]);

	if (contributions.length === 0) return null;

	return (
		<div data-qa-id={qaId}>
			{contributions.map((contribution, index) => {
				if (typeof contribution.component !== "function") return null;
				const Component = contribution.component as ComponentType;
				return (
					<Component key={`${contribution.featureId}:${contribution.label}:${String(index)}`} />
				);
			})}
		</div>
	);
}

function HeaderOutlets() {
	return (
		<>
			<ZoneOutletStandIn zone={HEADER_LEADING_ZONE} qaId="zone-header-leading" />
			<ZoneOutletStandIn zone={HEADER_TRAILING_ZONE} qaId="zone-header-trailing" />
		</>
	);
}

function CanvasPanel({
	instanceId,
	sessionId,
	title,
	workspaceDirectory,
}: ChatRightPanelContributionProps) {
	return (
		<div
			data-qa-id="test-canvas-panel"
			data-instance-id={instanceId}
			data-session-id={sessionId}
			data-workspace-directory={workspaceDirectory}
		>
			{title}
		</div>
	);
}

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	const fakeState = {
		thread: { messages: [], isRunning: false, isEmpty: true, suggestions: [] },
		threadListItem: { remoteId: undefined as string | undefined, status: "new" as const },
	};
	return {
		...actual,
		AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
		useAuiState: (selector: (state: typeof fakeState) => unknown) => selector(fakeState),
	};
});

vi.mock("./runtime/use-kilo-runtime.js", () => ({
	useKiloRuntime: vi.fn(() => ({})),
}));

vi.mock("./plan/use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => ({
		byMessageId: new Map(),
		byAnchorCallId: new Map(),
		newest: undefined,
	}),
}));

vi.mock("../account/KiloAuthProvider.js", () => ({
	KiloAuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./model-selection/use-kilo-model-catalog.js", () => ({
	useKiloModelCatalog: vi.fn(() => ({
		data: undefined,
		isPending: false,
		isError: false,
	})),
}));

vi.mock("./agent-selection/use-kilo-agent-catalog.js", () => ({
	useKiloAgentCatalog: vi.fn(() => ({
		data: undefined,
		isPending: false,
		isError: false,
	})),
}));

const threadMount = vi.hoisted(() => ({ nextId: 0 }));

vi.mock("./components/assistant-ui/thread.js", async () => {
	const { useState } = await import("react");
	return {
		Thread: function ThreadMock() {
			const [instanceId] = useState(() => String(++threadMount.nextId));
			return (
				<div data-qa-id="kilo-chat-thread-mock" data-thread-instance={instanceId}>
					Thread
				</div>
			);
		},
	};
});

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

const workspace: Workspace = {
	id: "workspace-1",
	name: "Workspace 1",
	folders: [
		{
			id: "folder-1",
			path: "/projects/workspace-1",
			isPrimary: true,
			position: 0,
		},
	],
	createdAt: 1,
	updatedAt: 1,
};

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderChatPage(options?: {
	getConnection?: KiloUiChatService["chat.getConnection"];
	prepareSession?: KiloUiChatService["chat.prepareSession"];
	workspaces?: Workspace[];
	children?: ReactNode;
}) {
	const getConnection = options?.getConnection ?? (async () => connection);
	const prepareSession =
		options?.prepareSession ?? (async () => ({ directory: "/tmp/chat", workspaceFolders: [] }));
	const workspaces = options?.workspaces ?? [];

	const kiloUi = createFakeSdk({
		featureId: "kilo-ui",
		channels: { ...workspacesContract, ...kiloUiChatContract },
		handlers: {
			list: async () => workspaces,
			get: async ({ id }) => workspaces.find((candidate) => candidate.id === id) ?? null,
			create: async () => workspace,
			update: async () => workspace,
			remove: async () => ({ deleted: true }),
			"chat.getConnection": getConnection,
			"chat.prepareSession": prepareSession,
		} satisfies Partial<WorkspacesService & KiloUiChatService>,
	});
	const system = createFakeFeatureSystem({
		sdks: { "kilo-ui": kiloUi },
	});
	const removeCanvasContribution = system
		.getSdk("canvas")
		.contribute(CHAT_RIGHT_PANEL_TAB_EXTENSION, {
			id: "canvas",
			label: "Canvas",
			description: "Scratch canvas",
			component: CanvasPanel,
		});
	const queryClient = testClient();
	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ChatFeatureProvider>
						<HeaderOutlets />
						<ChatPage />
						{options?.children}
					</ChatFeatureProvider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, queryClient, sdk: kiloUi, removeCanvasContribution };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	useRightPanelStore.setState({ bySessionId: {} });
	threadMount.nextId = 0;
	vi.clearAllMocks();
});

describe("chat connection context", () => {
	it("returns the nearest connection status", () => {
		const status = {
			isPending: false,
			isError: false,
			error: null,
			connection,
			connectionPromise: Promise.resolve(connection),
		};
		const wrapper = ({ children }: { children: ReactNode }) => (
			<ChatConnectionProvider status={status}>{children}</ChatConnectionProvider>
		);

		const { result } = renderHook(() => useChatConnection(), { wrapper });
		expect(result.current).toBe(status);
	});

	it("rejects consumers outside the provider", () => {
		expect(() => renderHook(() => useChatConnection())).toThrow(
			/useChatConnection requires ChatConnectionProvider/,
		);
	});
});

describe("ChatPage error rendering", () => {
	function renderWithStatus(status: ChatConnectionStatus) {
		const kiloUi = createFakeSdk({
			featureId: "kilo-ui",
			channels: { ...workspacesContract, ...kiloUiChatContract },
			handlers: {
				list: async () => [],
				get: async () => null,
				create: async () => workspace,
				update: async () => workspace,
				remove: async () => ({ deleted: true }),
				"chat.getConnection": async () => connection,
				"chat.prepareSession": async () => ({ directory: "/tmp/chat", workspaceFolders: [] }),
			} satisfies Partial<WorkspacesService & KiloUiChatService>,
		});
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": kiloUi } });
		const queryClient = testClient();
		const sessionActivity = createSessionActivityStore({ storage: null });
		return render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<WorkspacesFeatureProvider>
						<SessionActivityProvider store={sessionActivity}>
							<ChatConnectionProvider status={status}>
								<ChatPage />
							</ChatConnectionProvider>
						</SessionActivityProvider>
					</WorkspacesFeatureProvider>
				</QueryClientProvider>
			</SdkProvider>,
		);
	}

	it("stringifies a non-Error connection failure in the banner", async () => {
		const { baseElement } = renderWithStatus({
			isPending: false,
			isError: true,
			// ChatPage defensively stringifies non-Error failures; force one past the Error | null type.
			error: "raw string failure" as unknown as Error,
			connectionPromise: new Promise<KiloGlobalConnection>(() => undefined),
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText(/Could not connect to Kilo: raw string failure/))
			.toBeVisible();
	});
});

describe("ChatFeatureProvider thread + prepareSession wiring", () => {
	it("resets the agent only when the thread id is cleared and prepares without a workspace", async () => {
		vi.mocked(useKiloAgentCatalog).mockReturnValue({
			data: {
				agents: [
					{ name: "code", displayName: "Code", icon: HammerIcon },
					{ name: "plan", displayName: "Plan", icon: ListTodoIcon },
				],
			},
			isPending: false,
			isError: false,
		} as never);
		const prepareSession = vi.fn(async () => ({ directory: "/tmp/chat", workspaceFolders: [] }));
		let setAgent!: (agent: string) => void;
		function CaptureAgentControls() {
			setAgent = useChatAgentSelection().setAgent;
			return null;
		}
		renderChatPage({
			getConnection: async () => connection,
			prepareSession,
			children: <CaptureAgentControls />,
		});

		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());

		// Move off the default agent so a reset is observable.
		setAgent("plan");
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0]?.defaultAgent).toBe("plan"),
		);

		// Selecting an existing thread keeps the current agent: give any errant
		// reset a chance to re-render, then confirm the agent is still "plan".
		vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-42");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0]?.defaultAgent).toBe("plan");

		// Clearing the thread id resets the agent back to the default.
		vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!(undefined);
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0]?.defaultAgent).toBe("code"),
		);

		// No active workspace was set, so prepareSession is called with empty options.
		await vi.mocked(useKiloRuntime).mock.lastCall![0].prepareSession!();
		expect(prepareSession).toHaveBeenLastCalledWith({});
	});

	it("passes the resolved default model and effort variant into the runtime", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: {
				providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
				models: [
					{
						id: "anthropic/claude-sonnet",
						name: "Claude Sonnet",
						providerID: "anthropic",
						modelID: "claude-sonnet",
						efforts: true,
					},
				],
				defaults: { anthropic: "claude-sonnet" },
			},
			isPending: false,
			isError: false,
		} as never);

		renderChatPage({ getConnection: async () => connection });

		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());
		await vi.waitFor(() => {
			const options = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(options?.defaultModel).toEqual({
				providerID: "anthropic",
				modelID: "claude-sonnet",
			});
			expect(options?.variant).toBeDefined();
		});
	});

	it("holds the connection promise identity while a refresh is in flight", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: undefined,
			isPending: false,
			isError: false,
		} as never);
		let resolveRefetch: ((value: KiloGlobalConnection) => void) | undefined;
		let call = 0;
		const getConnection = vi.fn<KiloUiChatService["chat.getConnection"]>(() => {
			call += 1;
			if (call === 1) return Promise.resolve(connection);
			return new Promise<KiloGlobalConnection>((resolve) => {
				resolveRefetch = resolve;
			});
		});
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledTimes(1));
		const settled = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
		await expect(settled).resolves.toEqual(connection);

		// Trigger a refetch via onError; while it is in flight the memo keeps the
		// current promise identity (line 118 held-during-refetch branch).
		vi.mocked(useKiloRuntime).mock.lastCall?.[0].onError?.(new Error("Unauthorized"));

		await vi.waitFor(() => expect(getConnection.mock.calls.length).toBeGreaterThan(1));
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).toBe(settled),
		);

		resolveRefetch?.(connection);
	});

	it("wraps a non-Error connection failure into an Error for the runtime promise", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: undefined,
			isPending: false,
			isError: false,
		} as never);
		const getConnection = vi.fn<KiloUiChatService["chat.getConnection"]>(async () => {
			// eslint-disable-next-line no-throw-literal
			throw "connection string failure";
		});
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalled());
		await vi.waitFor(() => {
			const promise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
			expect(promise).toBeDefined();
		});
		const promise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
		await expect(promise).rejects.toThrow();
	});
});

describe("ChatPage", () => {
	it("renders the thread while the connection is still pending", async () => {
		const { baseElement } = renderChatPage({
			getConnection: () => new Promise<KiloGlobalConnection>(() => undefined),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-loading")).not.toBeInTheDocument();
	});

	it("shows an error banner when the connection fails but keeps the thread mounted", async () => {
		const { baseElement } = renderChatPage({
			getConnection: async () => {
				throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-error")).toBeVisible();
		await expect
			.element(screen.getByText(/Could not connect to Kilo: Kilo Server requires the desktop app/))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});

	it("keeps the same connectionPromise identity while the connection resolves", async () => {
		let resolveConnection!: (value: KiloGlobalConnection) => void;
		const getConnection = vi.fn(
			() =>
				new Promise<KiloGlobalConnection>((resolve) => {
					resolveConnection = resolve;
				}),
		);
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		const pendingPromise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
		expect(pendingPromise).toBeDefined();

		resolveConnection(connection);
		await expect(pendingPromise).resolves.toEqual(connection);

		await vi.waitFor(() => {
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).toBe(pendingPromise);
		});
	});

	it("refreshes the global connection after a runtime request fails", async () => {
		const refreshedConnection = {
			...connection,
			baseUrl: "http://127.0.0.1:5432",
			password: "refreshed-secret",
		};
		let connectionCalls = 0;
		const getConnection = vi.fn<KiloUiChatService["chat.getConnection"]>(async () => {
			connectionCalls += 1;
			return connectionCalls === 1 ? connection : refreshedConnection;
		});
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalled());
		const initialRuntimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
		expect(initialRuntimeOptions?.onError).toEqual(expect.any(Function));
		await expect(initialRuntimeOptions!.connectionPromise).resolves.toEqual(connection);

		const callsBeforeRefresh = getConnection.mock.calls.length;
		initialRuntimeOptions!.onError!(new Error("Unauthorized"));

		await vi.waitFor(() =>
			expect(getConnection.mock.calls.length).toBeGreaterThan(callsBeforeRefresh),
		);
		await vi.waitFor(() => {
			const refreshedPromise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
			expect(refreshedPromise).not.toBe(initialRuntimeOptions!.connectionPromise);
		});
		await expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).resolves.toEqual(
			refreshedConnection,
		);
	});

	it("requests one global connection without preparing a session", async () => {
		const getConnection = vi.fn(async () => connection);
		const prepareSession = vi.fn(async () => ({
			directory: "/tmp/chat",
			workspaceFolders: [],
		}));
		const { baseElement } = renderChatPage({ getConnection, prepareSession });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		expect(getConnection).toHaveBeenCalledWith(undefined);
		expect(prepareSession).not.toHaveBeenCalled();
	});

	it("opens the right panel from the header trailing toggle", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-right-panel-toggle")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel")).not.toBeInTheDocument();

		await screen.getByTestId("chat-right-panel-toggle").click();

		await expect.element(screen.getByTestId("chat-right-panel")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-maximize")).toBeVisible();
	});

	it("adds multiple numbered instances from a live contribution", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-right-panel-toggle").click();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).toBeVisible();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();

		await expect.element(screen.getByTestId("test-canvas-panel")).toHaveTextContent("Canvas 1");
		const firstCanvas = baseElement.querySelector<HTMLElement>("[data-qa-id='test-canvas-panel']");
		expect(firstCanvas).not.toBeNull();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).not.toBeInTheDocument();

		await screen.getByTestId("chat-right-panel-add-tab").click();
		await screen.getByTestId("chat-right-panel-add-canvas-canvas").click();
		await vi.waitFor(() => {
			expect(baseElement.querySelectorAll("[data-qa-id='test-canvas-panel']")).toHaveLength(2);
		});
		expect(firstCanvas?.isConnected).toBe(true);
		expect(firstCanvas?.textContent).toContain("Canvas 1");
		expect(
			baseElement.querySelector<HTMLElement>(
				"[data-active='true'] [data-qa-id='test-canvas-panel']",
			)?.textContent,
		).toContain("Canvas 2");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs.map(({ title }) => title)).toEqual(
			["Canvas 1", "Canvas 2"],
		);
	});

	it("shows generic dirty state and keeps the tab after Save is cancelled", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		const save = vi.fn(async () => ({ outcome: "cancelled" as const }));
		const discard = vi.fn(async () => undefined);
		const unregister = chatRightPanelCapability.registerTabLifecycle("draft", tab.instanceId, {
			save,
			discard,
		});
		chatRightPanelCapability.setTabDirty("draft", tab.instanceId, true);

		await expect
			.element(screen.getByTestId(`chat-right-panel-dirty-${tab.instanceId}`))
			.toBeVisible();
		await screen.getByTestId(`chat-right-panel-close-tab-${tab.instanceId}`).click();
		await expect.element(screen.getByTestId("chat-right-panel-close-dialog")).toBeVisible();

		await screen.getByTestId("chat-right-panel-close-save").click();
		await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("chat-right-panel-close-dialog")).toBeVisible();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);

		await screen.getByTestId("chat-right-panel-close-discard").click();
		await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce());
		await expect
			.element(screen.getByTestId("chat-right-panel-close-dialog"))
			.not.toBeInTheDocument();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
		unregister();
	});

	it("offers Discard and Cancel when a dirty tab has no save handler", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		chatRightPanelCapability.setTabDirty("draft", tab.instanceId, true);

		await screen.getByTestId(`chat-right-panel-close-tab-${tab.instanceId}`).click();

		await expect.element(screen.getByTestId("chat-right-panel-close-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-close-save")).not.toBeInTheDocument();
		await screen.getByTestId("chat-right-panel-close-cancel").click();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
	});

	it("disables close actions while pending and retains the tab after lifecycle failures", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		let resolveSave!: (result: { outcome: "failed"; reason: string }) => void;
		const save = vi.fn(
			() =>
				new Promise<{ outcome: "failed"; reason: string }>((resolve) => {
					resolveSave = resolve;
				}),
		);
		const discard = vi.fn(async () => {
			throw new Error("Discard cleanup failed");
		});
		const unregister = chatRightPanelCapability.registerTabLifecycle("draft", tab.instanceId, {
			save,
			discard,
		});
		chatRightPanelCapability.setTabDirty("draft", tab.instanceId, true);
		await screen.getByTestId(`chat-right-panel-close-tab-${tab.instanceId}`).click();

		await screen.getByTestId("chat-right-panel-close-save").click();
		await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("chat-right-panel-close-save")).toBeDisabled();
		await expect.element(screen.getByTestId("chat-right-panel-close-discard")).toBeDisabled();
		await expect.element(screen.getByTestId("chat-right-panel-close-cancel")).toBeDisabled();
		resolveSave({ outcome: "failed", reason: "Save failed" });

		await expect
			.element(screen.getByTestId("chat-right-panel-close-error"))
			.toHaveTextContent("Save failed");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
		await screen.getByTestId("chat-right-panel-close-discard").click();
		await expect
			.element(screen.getByTestId("chat-right-panel-close-error"))
			.toHaveTextContent("Discard cleanup failed");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
		unregister();
	});

	it("closes a clean tab without prompting", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;

		await screen.getByTestId(`chat-right-panel-close-tab-${tab.instanceId}`).click();

		await expect
			.element(screen.getByTestId("chat-right-panel-close-dialog"))
			.not.toBeInTheDocument();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
	});

	it("keeps an existing tab closeable when its contributing plugin disappears", async () => {
		const { baseElement, removeCanvasContribution } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();
		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();

		removeCanvasContribution();
		await expect
			.element(screen.getByTestId("chat-right-panel-contribution-unavailable"))
			.toBeVisible();
		expect(baseElement.querySelector("[data-qa-id^='chat-right-panel-close-tab-']")).toBeTruthy();
	});

	it("shows the plan tab when openPlan is called for the session", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		useRightPanelStore.getState().openPlan("draft");

		await expect.element(screen.getByTestId("chat-right-panel")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-tab-plan")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-plan-empty")).toBeVisible();
	});

	it("maximizes the right panel without unmounting the chat column", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-right-panel-toggle").click();
		await expect.element(screen.getByTestId("kilo-chat-thread")).toBeVisible();
		const threadBefore = baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']");
		const instanceBefore = threadBefore?.getAttribute("data-thread-instance");
		expect(instanceBefore).toBeTruthy();

		await expect.element(screen.getByTestId("chat-right-panel-resize")).toBeVisible();
		await screen.getByTestId("chat-right-panel-maximize").click();

		await expect.element(screen.getByTestId("chat-right-panel")).toBeVisible();
		expect(
			baseElement
				.querySelector("[data-qa-id='chat-right-panel']")
				?.getAttribute("data-right-panel-maximized"),
		).toBe("true");
		expect(
			baseElement
				.querySelector("[data-qa-id='kilo-chat-thread']")
				?.getAttribute("data-chat-column-maximized-away"),
		).toBe("true");
		await expect.element(screen.getByTestId("chat-right-panel-resize")).not.toBeInTheDocument();
		expect(
			baseElement
				.querySelector("[data-qa-id='kilo-chat-thread-mock']")
				?.getAttribute("data-thread-instance"),
		).toBe(instanceBefore);
	});

	it("keeps the same thread instance when opening the right panel", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		const instanceBefore = baseElement
			.querySelector("[data-qa-id='kilo-chat-thread-mock']")
			?.getAttribute("data-thread-instance");
		expect(instanceBefore).toBeTruthy();

		await screen.getByTestId("chat-right-panel-toggle").click();
		await expect.element(screen.getByTestId("chat-right-panel")).toBeVisible();

		expect(
			baseElement
				.querySelector("[data-qa-id='kilo-chat-thread-mock']")
				?.getAttribute("data-thread-instance"),
		).toBe(instanceBefore);
	});

	it("passes the draft chat's primary workspace directory to right-panel contributions", async () => {
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		const { baseElement } = renderChatPage({ workspaces: [workspace] });
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-right-panel-toggle").click();
		await screen.getByTestId("chat-right-panel-open-canvas-canvas").click();

		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-directory", "/projects/workspace-1");
	});

	it("uses the latest workspace only when the runtime prepares a new session", async () => {
		const otherWorkspace: Workspace = {
			...workspace,
			id: "workspace-2",
			name: "Workspace 2",
			folders: [
				{
					id: "folder-2",
					path: "/projects/workspace-2",
					isPrimary: true,
					position: 0,
				},
			],
		};
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		const getConnection = vi.fn(async () => connection);
		const prepareSession = vi.fn(async ({ workspaceId }: { workspaceId?: string | undefined }) => ({
			directory: workspaceId ? `/projects/${workspaceId}` : "/tmp/chat",
			workspaceFolders: [],
		}));
		const { baseElement, sdk } = renderChatPage({
			getConnection,
			prepareSession,
			workspaces: [workspace, otherWorkspace],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		const runtimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
		expect(runtimeOptions?.prepareSession).toEqual(expect.any(Function));
		await runtimeOptions!.prepareSession!();
		expect(prepareSession).toHaveBeenLastCalledWith({ workspaceId: workspace.id });

		const threadBefore = baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']");
		const instanceBefore = threadBefore?.getAttribute("data-thread-instance");
		expect(instanceBefore).toBeTruthy();

		sdk.state.register<string | null>("active-workspace", workspace.id).set(otherWorkspace.id);

		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].prepareSession).toBe(
				runtimeOptions!.prepareSession,
			),
		);
		await runtimeOptions!.prepareSession!();
		expect(prepareSession).toHaveBeenLastCalledWith({ workspaceId: otherWorkspace.id });
		expect(getConnection).toHaveBeenCalledOnce();

		const threadAfter = baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']");
		expect(threadAfter?.getAttribute("data-thread-instance")).toBe(instanceBefore);
	});
});
