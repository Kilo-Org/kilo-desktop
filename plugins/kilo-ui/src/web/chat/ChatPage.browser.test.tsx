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
import { ChatConnectionProvider, useChatConnection } from "./connection/ChatConnectionContext.js";
import { ChatFeatureProvider } from "./ChatFeatureProvider.js";
import { ChatPage } from "./ChatPage.js";
import { useRightPanelStore } from "./right-panel/right-panel-store.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";

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

vi.mock("../account/KiloAuthContext.js", () => ({
	useKiloAuth: () => ({
		isLoading: true,
		connectionUnavailable: false,
		authenticated: null,
		profile: null,
		deviceAuth: { status: "idle" as const },
		isRefreshing: false,
		isSwitchingOrg: false,
		login: () => undefined,
		cancelLogin: () => undefined,
		logout: () => undefined,
		refreshProfile: () => undefined,
		setOrganization: () => undefined,
		openExternal: () => undefined,
	}),
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
	const queryClient = testClient();
	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<ChatFeatureProvider>
						<HeaderOutlets />
						<ChatPage />
					</ChatFeatureProvider>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, queryClient, sdk: kiloUi };
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

	it("adds the placeholder tab from the empty state", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-right-panel-toggle").click();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).toBeVisible();
		await screen.getByTestId("chat-right-panel-open-placeholder").click();

		await expect.element(screen.getByTestId("chat-right-panel-tab-placeholder")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-placeholder")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).not.toBeInTheDocument();
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
