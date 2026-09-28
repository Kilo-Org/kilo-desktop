import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import {
	FeatureError,
	type Contribution,
	type PluginPageProps,
	type SDK,
} from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";

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
import {
	layoutPresetsContract,
	type LayoutPresetsService,
	type LayoutPresetsState,
} from "../../contracts/layout-presets/schemas.js";
import { WorkspacesFeatureProvider } from "../workspaces/WorkspacesFeatureProvider.js";
import { ChatConnectionProvider, useChatConnection } from "./connection/ChatConnectionContext.js";
import { ChatFeatureProvider } from "./ChatFeatureProvider.js";
import { ChatPage, ChatPageHeaderActions, ChatPageHeaderLeading } from "./ChatPage.js";
import {
	FILES_EXPLORER_PANE_ID,
	FILES_PANE_DEFINITION_ID,
} from "./pane-canvas/default-workspace-files-pane.js";
import { useSessionActivity } from "./session-activity/SessionActivityProvider.js";
import type { SessionSummaryInput } from "./session-activity/session-activity-store.js";
import type { ChatSessionWorkspaceCapabilities } from "./session-workspace/chat-session-workspace-capability.js";
import {
	CHAT_RIGHT_PANEL_TAB_EXTENSION,
	type ChatRightPanelContributionProps,
} from "./right-panel/right-panel-tab-registry.js";
import { chatRightPanelCapability } from "./right-panel/chat-right-panel-capability.js";
import { useRightPanelStore } from "./right-panel/right-panel-store.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { useKiloModelCatalog } from "./model-selection/use-kilo-model-catalog.js";
import type * as KiloModelCatalogModule from "./model-selection/use-kilo-model-catalog.js";
import { useChatModelSelection } from "./model-selection/ChatModelSelectionContext.js";
import { useKiloAgentCatalog } from "./agent-selection/use-kilo-agent-catalog.js";
import { useChatAgentSelection } from "./agent-selection/ChatAgentSelectionContext.js";
import { useChatAutoApprove } from "./auto-approve/ChatAutoApproveContext.js";
import { KILO_PROVIDER_LIST_QUERY_KEY } from "../providers/provider-queries.js";
import { HammerIcon, ListTodoIcon } from "lucide-react";
import type * as ThreadModule from "./components/assistant-ui/thread.js";

function FilesPanel({
	instanceId,
	sessionId,
	title,
	workspaceDirectory,
}: ChatRightPanelContributionProps) {
	return (
		<div
			data-qa-id="test-files-panel"
			data-instance-id={instanceId}
			data-session-id={sessionId}
			data-workspace-directory={workspaceDirectory}
		>
			{title}
		</div>
	);
}

function CanvasPanel({
	instanceId,
	sessionId,
	title,
	workspaceDirectory,
	workspaceFolders,
}: ChatRightPanelContributionProps) {
	return (
		<div
			data-qa-id="test-canvas-panel"
			data-instance-id={instanceId}
			data-session-id={sessionId}
			data-workspace-directory={workspaceDirectory}
			data-workspace-folders={workspaceFolders?.map((folder) => folder.path).join("|")}
		>
			{title}
			<input aria-label="Canvas draft" />
		</div>
	);
}

function NotebookPanel({ instanceId, title }: ChatRightPanelContributionProps) {
	return (
		<div data-qa-id="test-notebook-panel" data-instance-id={instanceId}>
			{title}
		</div>
	);
}

const assistantState = vi.hoisted(() => ({
	current: {
		thread: {
			messages: [] as Array<{ role: string }>,
			isRunning: false,
			isEmpty: true,
			suggestions: [],
			extras: undefined as unknown,
		},
		threadListItem: {
			id: "draft",
			remoteId: undefined as string | undefined,
			status: "new" as "new" | "regular",
			title: "Session",
		},
	},
}));
vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
		useAuiState: (selector: (state: typeof assistantState.current) => unknown) =>
			selector(assistantState.current),
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

vi.mock("./model-selection/use-kilo-model-catalog.js", async (importOriginal) => {
	const actual = await importOriginal<typeof KiloModelCatalogModule>();
	return {
		...actual,
		useKiloModelCatalog: vi.fn(() => ({
			data: undefined,
			isPending: false,
			isError: false,
		})),
	};
});

vi.mock("./agent-selection/use-kilo-agent-catalog.js", () => ({
	useKiloAgentCatalog: vi.fn(() => ({
		data: undefined,
		isPending: false,
		isError: false,
	})),
}));

const threadMount = vi.hoisted(() => ({ nextId: 0, renderCount: 0 }));

vi.mock("./components/assistant-ui/thread.js", async (importOriginal) => {
	const actual = await importOriginal<typeof ThreadModule>();
	return {
		...actual,
		Thread: function ThreadMock() {
			threadMount.renderCount += 1;
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
	layoutPresets?: LayoutPresetsState;
	getLayoutPresets?: LayoutPresetsService["layoutPresets.get"];
	saveLayoutPreset?: LayoutPresetsService["layoutPresets.save"];
	getConnection?: KiloUiChatService["chat.getConnection"];
	prepareSession?: KiloUiChatService["chat.prepareSession"];
	workspaces?: Workspace[];
	activeWorkspaceId?: string | null;
	contributeFiles?: boolean;
	contributeNotebook?: boolean;
	children?: ReactNode;
	canvasMountPolicy?: Contribution["mountPolicy"];
	prepareModel?: (modelId: string) => Promise<void>;
	connectLocalInference?: () => Promise<void>;
	shell?: Partial<SDK["shell"]>;
	pageProps?: Partial<PluginPageProps>;
	layoutsEnabled?: boolean;
	featureFlags?: SDK["featureFlags"];
}) {
	const getConnection = options?.getConnection ?? (async () => connection);
	const prepareSession =
		options?.prepareSession ?? (async () => ({ directory: "/tmp/chat", workspaceFolders: [] }));
	const workspaces = options?.workspaces ?? [];
	if (options?.activeWorkspaceId) {
		localStorage.setItem("kilo-ui.active-workspace", options.activeWorkspaceId);
	}

	const kiloUi = createFakeSdk({
		featureId: "kilo-ui",
		channels: { ...workspacesContract, ...kiloUiChatContract, ...layoutPresetsContract },
		handlers: {
			list: async () => workspaces,
			get: async ({ id }) => workspaces.find((candidate) => candidate.id === id) ?? null,
			create: async () => workspace,
			update: async () => workspace,
			remove: async () => ({ deleted: true }),
			"chat.getConnection": getConnection,
			"chat.prepareSession": prepareSession,
			"layoutPresets.get":
				options?.getLayoutPresets ??
				(async () => options?.layoutPresets ?? { presets: [], defaultPresetId: null }),
			...(options?.saveLayoutPreset ? { "layoutPresets.save": options.saveLayoutPreset } : {}),
		} satisfies Partial<WorkspacesService & KiloUiChatService & LayoutPresetsService>,
		...(options?.shell ? { shell: options.shell } : {}),
		featureFlags: options?.featureFlags ?? {
			peek: () => ({ "chat-layouts": options?.layoutsEnabled ?? true }),
			subscribe: (listener) => {
				listener({ "chat-layouts": options?.layoutsEnabled ?? true });
				return () => undefined;
			},
		},
	});
	const system = createFakeFeatureSystem({
		sdks: { "kilo-ui": kiloUi },
	});
	const localInference = system.getSdk("local-inference");
	const kiloServer = system.getSdk("kilo-server");
	if (options?.prepareModel || options?.connectLocalInference) {
		localInference.plugins.expose("localInference", {
			prepareModel: options.prepareModel ?? (async () => undefined),
			connect: options.connectLocalInference ?? (async () => undefined),
		});
	}
	const removeCanvasContribution = system
		.getSdk("canvas")
		.contribute(CHAT_RIGHT_PANEL_TAB_EXTENSION, {
			id: "canvas",
			label: "Canvas",
			description: "Scratch canvas",
			component: CanvasPanel,
			icon: HammerIcon,
			...(options?.canvasMountPolicy ? { mountPolicy: options.canvasMountPolicy } : {}),
		});
	const removeFilesContribution = options?.contributeFiles
		? system.getSdk("files").contribute(CHAT_RIGHT_PANEL_TAB_EXTENSION, {
				id: "files",
				label: "Files",
				description: "Browse workspace files",
				component: FilesPanel,
			})
		: undefined;
	const removeNotebookContribution = options?.contributeNotebook
		? system.getSdk("notebook").contribute(CHAT_RIGHT_PANEL_TAB_EXTENSION, {
				id: "notebook",
				label: "Notebook",
				description: "Scratch notebook",
				component: NotebookPanel,
			})
		: undefined;
	const queryClient = testClient();
	const renderView = () => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<SidebarProvider>
					<WorkspacesFeatureProvider>
						<ChatFeatureProvider>
							<ChatPageHeaderActions />
							{options?.pageProps ? (
								<div className="h-[600px]">
									<ChatPage {...options.pageProps} />
								</div>
							) : (
								<ChatPage />
							)}
							{options?.children}
						</ChatFeatureProvider>
					</WorkspacesFeatureProvider>
				</SidebarProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
	const result = render(renderView());
	return {
		...result,
		queryClient,
		sdk: kiloUi,
		localInference,
		kiloServer,
		removeCanvasContribution,
		removeFilesContribution,
		removeNotebookContribution,
		rerenderChatPage: () => result.rerender(renderView()),
	};
}

async function openFirstCanvasPane(screen: ReturnType<typeof page.elementLocator>) {
	assistantState.current.threadListItem.status = "regular";
	useRightPanelStore.getState().openTab("draft", { id: "canvas.canvas", title: "Canvas" });
	await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
}

function openWorkspaceFilesExplorer() {
	useRightPanelStore.getState().openTab(
		"draft",
		{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
		{
			activate: false,
			instanceId: FILES_EXPLORER_PANE_ID,
			title: "workspace-1",
			metadata: { workspaceDirectory: "/projects/workspace-1" },
		},
	);
}

function addTabInActiveGroup(baseElement: HTMLElement) {
	return (
		baseElement
			.querySelector("[data-pane-tab][data-active='true']")
			?.closest("[data-pane-group-id]")
			?.querySelector<HTMLElement>("[data-qa-id='chat-pane-add-tab']") ?? null
	);
}

async function clickAddTab(baseElement: HTMLElement) {
	const add = addTabInActiveGroup(baseElement);
	expect(add).toBeTruthy();
	await page.elementLocator(add!).click();
}

async function launchCanvasFromAddTab(baseElement: HTMLElement) {
	await clickAddTab(baseElement);
	await page.getByTestId("chat-pane-add-menu-canvas.canvas").click();
}

beforeEach(async () => {
	await page.viewport(1200, 800);
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	useRightPanelStore.setState({ bySessionId: {} });
	threadMount.nextId = 0;
	threadMount.renderCount = 0;
	assistantState.current.thread.messages = [];
	assistantState.current.thread.isEmpty = true;
	assistantState.current.thread.extras = undefined;
	assistantState.current.threadListItem.remoteId = undefined;
	assistantState.current.threadListItem.id = "draft";
	assistantState.current.threadListItem.status = "new";
	assistantState.current.threadListItem.title = "Session";
	vi.clearAllMocks();
});

describe("chat layout presets", () => {
	const filesDefault: LayoutPresetsState = {
		defaultPresetId: "files",
		presets: [
			{
				id: "files",
				name: "Files beside chat",
				template: {
					version: 1,
					arrangement: "carousel",
					activePaneId: "chat",
					slots: [
						{ id: "chat", type: "chat" },
						{ id: "files", type: "files" },
					],
					groups: [
						{ id: "chat", tabs: ["chat"], activePaneId: "chat", width: 600, pinned: false },
						{ id: "files", tabs: ["files"], activePaneId: "files", width: 400, pinned: true },
					],
				},
			},
		],
	};
	const codingPreset: LayoutPresetsState = {
		defaultPresetId: "coding",
		presets: [
			{
				id: "coding",
				name: "Coding",
				template: {
					version: 1,
					arrangement: "tiles",
					activePaneId: "changes",
					slots: [
						{ id: "chat", type: "chat" },
						{ id: "changes", type: "changes" },
					],
					groups: [
						{ id: "chat", tabs: ["chat"], activePaneId: "chat", width: 600, pinned: false },
						{
							id: "changes",
							tabs: ["changes"],
							activePaneId: "changes",
							width: 400,
							pinned: false,
						},
					],
				},
			},
		],
	};

	it("shows the layouts control only after the chat enters the pane canvas", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("chat-layouts-menu")).not.toBeInTheDocument();
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await expect.element(screen.getByTestId("chat-layouts-menu")).toBeVisible();
	});

	it("hides layouts and does not load a saved default while the feature flag is off", async () => {
		const getLayoutPresets = vi.fn(async () => filesDefault);
		const { baseElement, rerenderChatPage } = renderChatPage({
			layoutsEnabled: false,
			layoutPresets: filesDefault,
			getLayoutPresets,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("chat-layouts-menu")).not.toBeInTheDocument();
		await vi.waitFor(() => expect(getLayoutPresets).not.toHaveBeenCalled());
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await expect.element(screen.getByTestId("test-files-panel")).not.toBeInTheDocument();
	});

	it("responds to the chat-layouts flag without changing existing pane state", async () => {
		let enabled = false;
		const subscribers = new Set<(flags: Record<string, unknown>) => void>();
		const featureFlags = {
			getAllFlags: async () => ({ "chat-layouts": enabled }),
			peek: () => ({ "chat-layouts": enabled }),
			subscribe: (listener: (flags: Record<string, unknown>) => void) => {
				subscribers.add(listener);
				listener({ "chat-layouts": enabled });
				return () => subscribers.delete(listener);
			},
		};
		const { baseElement } = renderChatPage({ featureFlags });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("chat-layouts-menu")).not.toBeInTheDocument();
		act(() => {
			enabled = true;
			for (const subscriber of subscribers) subscriber({ "chat-layouts": enabled });
		});
		await expect.element(screen.getByTestId("chat-layouts-menu")).not.toBeInTheDocument();
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		act(() => useRightPanelStore.getState().setArrangement("draft", "carousel"));
		await expect.element(screen.getByTestId("chat-layouts-menu")).toBeVisible();
		act(() => {
			enabled = false;
			for (const subscriber of subscribers) subscriber({ "chat-layouts": enabled });
		});
		await expect.element(screen.getByTestId("chat-layouts-menu")).not.toBeInTheDocument();
		expect(useRightPanelStore.getState().bySessionId.draft?.arrangement).toBe("carousel");
	});

	it("saves the current layout from the pane canvas header", async () => {
		const saveLayoutPreset = vi.fn<LayoutPresetsService["layoutPresets.save"]>(
			async ({ name, template }) => ({
				presets: [{ id: "saved", name, template }],
				defaultPresetId: null,
			}),
		);
		const { baseElement } = renderChatPage({ saveLayoutPreset });
		const screen = page.elementLocator(baseElement);
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		act(() => useRightPanelStore.getState().setArrangement("draft", "tiles"));
		await screen.getByTestId("chat-layouts-menu").click();
		await page.getByTestId("chat-layout-save-current").click();
		await page.getByTestId("chat-layout-name").fill("Chat only");
		await page.getByTestId("chat-layout-save").click();
		await vi.waitFor(() =>
			expect(saveLayoutPreset).toHaveBeenCalledWith({
				name: "Chat only",
				makeDefault: false,
				template: {
					version: 1,
					arrangement: "tiles",
					activePaneId: "slot-1",
					slots: [{ id: "slot-1", type: "chat" }],
					groups: [
						expect.objectContaining({ tabs: ["slot-1"], activePaneId: "slot-1", pinned: false }),
					],
				},
			}),
		);
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});

	it("initializes a new draft when its default arrives and preserves pane identity through promotion", async () => {
		let resolvePresets!: (state: LayoutPresetsState) => void;
		const pending = new Promise<LayoutPresetsState>((resolve) => {
			resolvePresets = resolve;
		});
		const { baseElement, rerenderChatPage } = renderChatPage({
			getLayoutPresets: () => pending,
			contributeFiles: true,
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		resolvePresets(filesDefault);
		await vi.waitFor(() =>
			expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1),
		);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		expect(tab.definitionId).toBe("files.files");
		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("test-files-panel")).not.toBeInTheDocument();

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await expect.element(screen.getByTestId("test-files-panel")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
		await expect
			.element(screen.getByTestId("test-files-panel"))
			.toHaveAttribute("data-workspace-directory", "/projects/workspace-1");
		const before = baseElement.querySelector("[data-qa-id='test-files-panel']");
		assistantState.current.threadListItem.remoteId = "session-default";
		rerenderChatPage();
		await expect
			.element(screen.getByTestId("test-files-panel"))
			.toHaveAttribute("data-session-id", "session-default");
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBe(before);
		expect(useRightPanelStore.getState().bySessionId.draft).toBeUndefined();
		expect(useRightPanelStore.getState().bySessionId["session-default"]?.tabs[0]?.instanceId).toBe(
			tab.instanceId,
		);
	});

	it.each([false, true])(
		"applies a pending default after first send (already promoted: %s)",
		async (promoted) => {
			let resolvePresets!: (state: LayoutPresetsState) => void;
			const pending = new Promise<LayoutPresetsState>((resolve) => {
				resolvePresets = resolve;
			});
			assistantState.current.threadListItem.id = "local-pending";
			const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
				getLayoutPresets: () => pending,
				contributeFiles: true,
			});
			const screen = page.elementLocator(baseElement);
			await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).not.toBeInTheDocument();
			assistantState.current.thread.messages = [{ role: "user" }];
			assistantState.current.thread.isEmpty = false;
			assistantState.current.threadListItem.status = "regular";
			rerenderChatPage();
			if (promoted) {
				assistantState.current.threadListItem.remoteId = "remote-pending";
				rerenderChatPage();
			}
			resolvePresets(filesDefault);
			await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
			await expect.element(screen.getByTestId("test-files-panel")).toBeVisible();
			const files = baseElement.querySelector("[data-qa-id='test-files-panel']");
			assistantState.current.threadListItem.remoteId = "remote-pending";
			rerenderChatPage();
			await expect
				.element(screen.getByTestId("test-files-panel"))
				.toHaveAttribute("data-session-id", "remote-pending");
			expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBe(files);
			expect(useRightPanelStore.getState().bySessionId["local-pending"]).toBeUndefined();
			expect(useRightPanelStore.getState().bySessionId["remote-pending"]?.tabs).toHaveLength(1);
			await expect
				.element(screen.getByTestId("kilo-chat-pane-canvas"))
				.toHaveAttribute("data-arrangement", "carousel");
		},
	);

	it("does not carry a pending default to an unrelated chat after navigation", async () => {
		let resolvePresets!: (state: LayoutPresetsState) => void;
		const pending = new Promise<LayoutPresetsState>((resolve) => {
			resolvePresets = resolve;
		});
		assistantState.current.threadListItem.id = "local-pending";
		const { queryClient, rerenderChatPage } = renderChatPage({ getLayoutPresets: () => pending });
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		assistantState.current.threadListItem.id = "existing-chat";
		assistantState.current.threadListItem.remoteId = "existing-chat";
		rerenderChatPage();
		resolvePresets(filesDefault);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		expect(useRightPanelStore.getState().bySessionId).toEqual({});
		assistantState.current.threadListItem.id = "local-pending";
		assistantState.current.threadListItem.remoteId = "remote-pending";
		rerenderChatPage();
		expect(useRightPanelStore.getState().bySessionId).toEqual({});
	});

	it.each(["before-send", "after-send", "after-promotion"])(
		"does not restore a pending default after pane edits %s",
		async (when) => {
			let resolvePresets!: (state: LayoutPresetsState) => void;
			const pending = new Promise<LayoutPresetsState>((resolve) => {
				resolvePresets = resolve;
			});
			assistantState.current.threadListItem.id = "local-pending";
			const { queryClient, rerenderChatPage } = renderChatPage({
				getLayoutPresets: () => pending,
			});
			const edit = (sessionId: string) => {
				act(() => {
					useRightPanelStore.getState().setArrangement(sessionId, "carousel");
					useRightPanelStore.getState().setArrangement(sessionId, "tiles");
				});
			};
			if (when === "before-send") edit("local-pending");
			assistantState.current.thread.messages = [{ role: "user" }];
			assistantState.current.threadListItem.status = "regular";
			rerenderChatPage();
			if (when === "after-send") edit("local-pending");
			assistantState.current.threadListItem.remoteId = "remote-pending";
			rerenderChatPage();
			if (when === "after-promotion") edit("remote-pending");
			resolvePresets(filesDefault);
			await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
			expect(useRightPanelStore.getState().bySessionId).toEqual({});
		},
	);

	it("preserves live panes edited before promotion while the default is pending", async () => {
		let resolvePresets!: (state: LayoutPresetsState) => void;
		const pending = new Promise<LayoutPresetsState>((resolve) => {
			resolvePresets = resolve;
		});
		assistantState.current.threadListItem.id = "local-pending";
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			getLayoutPresets: () => pending,
			contributeFiles: true,
		});
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		act(() => {
			useRightPanelStore
				.getState()
				.openTab(
					"local-pending",
					{ id: "canvas.canvas", title: "Canvas" },
					{ instanceId: "live-canvas" },
				);
		});
		const screen = page.elementLocator(baseElement);
		await screen.getByRole("textbox", { name: "Canvas draft" }).fill("Unsaved before promotion");
		const canvas = baseElement.querySelector("[data-qa-id='test-canvas-panel']");
		assistantState.current.threadListItem.remoteId = "remote-pending";
		act(() => {
			queryClient.setQueryData(["kilo-ui", "layout-presets"], filesDefault);
			rerenderChatPage();
		});
		resolvePresets(filesDefault);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		await expect
			.element(screen.getByRole("textbox", { name: "Canvas draft" }))
			.toHaveValue("Unsaved before promotion");
		expect(baseElement.querySelector("[data-qa-id='test-canvas-panel']")).toBe(canvas);
		await expect.element(screen.getByTestId("test-files-panel")).not.toBeInTheDocument();
		expect(useRightPanelStore.getState().bySessionId["local-pending"]).toBeUndefined();
		expect(useRightPanelStore.getState().bySessionId["remote-pending"]?.tabs).toEqual([
			expect.objectContaining({ instanceId: "live-canvas" }),
		]);
	});

	it("applies a selected layout from the pane canvas", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			layoutPresets: { ...filesDefault, defaultPresetId: null },
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await screen.getByTestId("chat-layouts-menu").click();
		await page.getByTestId("chat-layout-apply-files").click();
		await vi.waitFor(() =>
			expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1),
		);
		await expect.element(screen.getByTestId("test-files-panel")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
	});

	it("does not persist unavailable roles from a selected layout", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			layoutPresets: { ...codingPreset, defaultPresetId: null },
		});
		const screen = page.elementLocator(baseElement);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await screen.getByTestId("chat-layouts-menu").click();
		await page.getByTestId("chat-layout-apply-coding").click();

		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});

	it("does not persist unavailable roles from the default layout", async () => {
		const { queryClient } = renderChatPage({ layoutPresets: codingPreset });
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
		expect(useRightPanelStore.getState().bySessionId.draft?.defaultLayoutInitialized).toBe(true);
	});

	it("does not apply a changed default until the next new-chat generation", async () => {
		const { queryClient, rerenderChatPage } = renderChatPage({ contributeFiles: true });
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		act(() => queryClient.setQueryData(["kilo-ui", "layout-presets"], filesDefault));
		rerenderChatPage();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		assistantState.current.thread.messages = [];
		assistantState.current.threadListItem.status = "new";
		rerenderChatPage();
		await vi.waitFor(() =>
			expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1),
		);
		const firstId = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!.instanceId;

		act(() => useRightPanelStore.getState().clearSession("draft"));
		act(() => queryClient.setQueryData(["kilo-ui", "layout-presets"], { ...filesDefault }));
		rerenderChatPage();
		expect(useRightPanelStore.getState().bySessionId.draft).toBeUndefined();
		assistantState.current.threadListItem.id = "next-draft";
		rerenderChatPage();
		await vi.waitFor(() =>
			expect(useRightPanelStore.getState().bySessionId["next-draft"]?.tabs).toHaveLength(1),
		);
		expect(useRightPanelStore.getState().bySessionId["next-draft"]?.tabs[0]?.instanceId).not.toBe(
			firstId,
		);
	});

	it("does not overwrite a draft changed while its default query was pending", async () => {
		let resolvePresets!: (state: LayoutPresetsState) => void;
		const pending = new Promise<LayoutPresetsState>((resolve) => {
			resolvePresets = resolve;
		});
		const { queryClient } = renderChatPage({ getLayoutPresets: () => pending });
		act(() => {
			useRightPanelStore.getState().setArrangement("draft", "carousel");
			useRightPanelStore.getState().setArrangement("draft", "tiles");
		});
		resolvePresets(filesDefault);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it.each([
		{ status: "regular" as const, remoteId: undefined, messages: [] },
		{ status: "new" as const, remoteId: "existing-empty", messages: [] },
		{ status: "new" as const, remoteId: undefined, messages: [{ role: "user" }] },
	])(
		"never initializes an existing thread $status/$remoteId/$messages",
		async ({ status, remoteId, messages }) => {
			assistantState.current.threadListItem.status = status;
			assistantState.current.threadListItem.remoteId = remoteId;
			assistantState.current.thread.messages = messages;
			const { queryClient } = renderChatPage({ layoutPresets: filesDefault });
			await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
			expect(useRightPanelStore.getState().bySessionId).toEqual({});
		},
	);

	it("keeps chat usable when layout preferences fail to load", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			getLayoutPresets: async () => {
				throw new Error("Unavailable");
			},
		});
		const screen = page.elementLocator(baseElement);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
	});

	it("preserves a resolved no-default draft across ChatPage remounts", async () => {
		const first = renderChatPage();
		await vi.waitFor(() => expect(first.queryClient.isFetching()).toBe(0));
		first.unmount();
		const second = renderChatPage({ layoutPresets: filesDefault });
		await vi.waitFor(() => expect(second.queryClient.isFetching()).toBe(0));
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("does not replace an already modified draft when ChatPage mounts", async () => {
		useRightPanelStore.getState().openTab("draft", { id: "canvas.canvas", title: "Canvas" });
		const { queryClient } = renderChatPage({ layoutPresets: filesDefault });
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		expect(
			useRightPanelStore.getState().bySessionId.draft?.tabs.map((tab) => tab.definitionId),
		).toEqual(["canvas.canvas"]);
	});

	it("initializes fresh panes after clearing the preceding submitted draft", async () => {
		const { queryClient, rerenderChatPage } = renderChatPage({
			layoutPresets: filesDefault,
			contributeFiles: true,
		});
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		const oldId = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!.instanceId;
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		act(() => useRightPanelStore.getState().setArrangement("draft", "tiles"));
		assistantState.current.thread.messages = [];
		assistantState.current.threadListItem.status = "new";
		rerenderChatPage();
		const next = useRightPanelStore.getState().bySessionId.draft!;
		expect(next.tabs).toHaveLength(1);
		expect(next.tabs[0]!.instanceId).not.toBe(oldId);
		expect(next.arrangement).toBe("carousel");
		expect(next.layoutJson).not.toContain(oldId);
	});

	it("retains mounted pane contents and dirty extras when applying a layout to a live chat", async () => {
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.threadListItem.status = "regular";
		const store = useRightPanelStore.getState();
		store.openTab(
			"draft",
			{ id: "canvas.canvas", title: "Canvas" },
			{ instanceId: "dirty-canvas" },
		);
		store.updateTab("draft", "dirty-canvas", { dirty: true });
		store.openTab("draft", { id: "files.files", title: "Files" }, { instanceId: "existing-files" });
		const { baseElement, queryClient } = renderChatPage({
			layoutPresets: filesDefault,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		await screen.getByTestId("chat-pane-tab-dirty-canvas").click();
		await screen.getByRole("textbox", { name: "Canvas draft" }).fill("Unsaved notes");
		const canvas = baseElement.querySelector("[data-qa-id='test-canvas-panel']");
		const files = baseElement.querySelector("[data-qa-id='test-files-panel']");
		expect(canvas).not.toBeNull();
		expect(files).not.toBeNull();
		await screen.getByTestId("chat-layouts-menu").click();
		await page.getByTestId("chat-layout-apply-files").click();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
		expect(baseElement.querySelector("[data-qa-id='test-canvas-panel']")).toBe(canvas);
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBe(files);
		await expect
			.element(screen.getByRole("textbox", { name: "Canvas draft" }))
			.toHaveValue("Unsaved notes");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toEqual([
			expect.objectContaining({ instanceId: "dirty-canvas", dirty: true }),
			expect.objectContaining({ instanceId: "existing-files" }),
		]);
	});
});

/** Stamps session activity inside ChatFeatureProvider's own store. */
function StampSessionActivity({ sessions }: { sessions: SessionSummaryInput[] }) {
	const hydrateSessions = useSessionActivity((state) => state.hydrateSessions);
	useEffect(() => {
		hydrateSessions(sessions);
	}, [hydrateSessions, sessions]);
	return null;
}

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

describe("ChatFeatureProvider thread + prepareSession wiring", () => {
	it("keeps model selection independent for each chat", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: {
				providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
				models: [
					{
						id: "anthropic/claude-sonnet",
						name: "Claude Sonnet",
						providerID: "anthropic",
						modelID: "claude-sonnet",
					},
					{
						id: "anthropic/claude-opus",
						name: "Claude Opus",
						providerID: "anthropic",
						modelID: "claude-opus",
					},
				],
				defaults: { anthropic: "claude-sonnet" },
			},
			isPending: false,
			isError: false,
		} as never);
		let selection!: ReturnType<typeof useChatModelSelection>;
		function CaptureModelSelection() {
			selection = useChatModelSelection();
			return null;
		}
		renderChatPage({ children: <CaptureModelSelection /> });
		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-a"));
		await vi.waitFor(() =>
			expect(selection.model).toEqual({
				providerID: "anthropic",
				modelID: "claude-sonnet",
			}),
		);

		act(() =>
			selection.setModel({
				providerID: "anthropic",
				modelID: "claude-opus",
			}),
		);
		expect(selection.model).toEqual({
			providerID: "anthropic",
			modelID: "claude-opus",
		});

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-b"));
		await vi.waitFor(() =>
			expect(selection.model).toEqual({
				providerID: "anthropic",
				modelID: "claude-sonnet",
			}),
		);

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-a"));
		await vi.waitFor(() =>
			expect(selection.model).toEqual({
				providerID: "anthropic",
				modelID: "claude-opus",
			}),
		);
	});

	it("keeps agent selection independent for each chat", async () => {
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
		let selection!: ReturnType<typeof useChatAgentSelection>;
		function CaptureAgentSelection() {
			selection = useChatAgentSelection();
			return null;
		}
		renderChatPage({ children: <CaptureAgentSelection /> });
		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-a"));
		await vi.waitFor(() => expect(selection.agent).toBe("code"));

		act(() => selection.setAgent("plan"));
		expect(selection.agent).toBe("plan");

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-b"));
		await vi.waitFor(() => expect(selection.agent).toBe("code"));

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-a"));
		await vi.waitFor(() => expect(selection.agent).toBe("plan"));
	});

	it("keeps auto-approve enabled across chats and restores it after remount", async () => {
		let autoApprove!: ReturnType<typeof useChatAutoApprove>;
		function CaptureAutoApprove() {
			autoApprove = useChatAutoApprove();
			return null;
		}
		const first = renderChatPage({ children: <CaptureAutoApprove /> });
		act(() => autoApprove.setEnabled?.(true));
		expect(autoApprove.enabled).toBe(true);
		expect(localStorage.getItem("kilo-ui:auto-approve")).toBe("true");
		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("another-chat"));
		expect(autoApprove.enabled).toBe(true);
		first.unmount();

		renderChatPage({ children: <CaptureAutoApprove /> });
		expect(autoApprove.enabled).toBe(true);
		act(() => autoApprove.setEnabled?.(false));
		expect(localStorage.getItem("kilo-ui:auto-approve")).toBe("false");
	});

	it("hydrates model, effort, and agent from the active Kilo session", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: {
				providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
				models: [
					{
						id: "anthropic/claude-sonnet",
						name: "Claude Sonnet",
						providerID: "anthropic",
						modelID: "claude-sonnet",
					},
					{
						id: "anthropic/claude-opus",
						name: "Claude Opus",
						providerID: "anthropic",
						modelID: "claude-opus",
						efforts: [{ id: "max", name: "Max" }],
					},
				],
				defaults: { anthropic: "claude-sonnet" },
			},
			isPending: false,
			isError: false,
		} as never);
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
		assistantState.current.threadListItem.remoteId = "thread-a";
		assistantState.current.thread.extras = {
			session: {
				id: "thread-a",
				agent: "plan",
				model: {
					id: "claude-opus",
					providerID: "anthropic",
					variant: "max",
				},
			},
			replyToQuestion: vi.fn(),
			rejectQuestion: vi.fn(),
			replyToPermission: vi.fn(),
		};
		let modelSelection!: ReturnType<typeof useChatModelSelection>;
		let agentSelection!: ReturnType<typeof useChatAgentSelection>;
		function CaptureSelections() {
			modelSelection = useChatModelSelection();
			agentSelection = useChatAgentSelection();
			return null;
		}
		renderChatPage({ children: <CaptureSelections /> });
		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());

		act(() => vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-a"));

		await vi.waitFor(() => expect(agentSelection.agent).toBe("plan"));
		await vi.waitFor(() =>
			expect(modelSelection.model).toEqual({
				providerID: "anthropic",
				modelID: "claude-opus",
			}),
		);
		expect(modelSelection.effort).toBe("max");
	});

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

		// Selecting an existing thread does not inherit the draft agent.
		vi.mocked(useKiloRuntime).mock.lastCall![0].onThreadIdChange!("thread-42");
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0]?.defaultAgent).toBe("code"),
		);

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

	it("uses the configured model and variant for each agent in a new chat", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: {
				providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
				models: [
					{
						id: "anthropic/claude-sonnet",
						name: "Claude Sonnet",
						providerID: "anthropic",
						modelID: "claude-sonnet",
						efforts: [{ id: "high", name: "High" }],
					},
					{
						id: "anthropic/claude-opus",
						name: "Claude Opus",
						providerID: "anthropic",
						modelID: "claude-opus",
						efforts: [{ id: "max", name: "Max" }],
					},
				],
				defaults: { anthropic: "claude-sonnet" },
			},
			isPending: false,
			isError: false,
		} as never);
		vi.mocked(useKiloAgentCatalog).mockReturnValue({
			data: {
				agents: [
					{
						name: "code",
						displayName: "Code",
						icon: HammerIcon,
						model: { providerID: "anthropic", modelID: "claude-sonnet" },
						variant: "high",
					},
					{
						name: "plan",
						displayName: "Plan",
						icon: ListTodoIcon,
						model: { providerID: "anthropic", modelID: "claude-opus" },
						variant: "max",
					},
				],
			},
			isPending: false,
			isError: false,
		} as never);
		let agentSelection!: ReturnType<typeof useChatAgentSelection>;
		function CaptureAgentSelection() {
			agentSelection = useChatAgentSelection();
			return null;
		}

		renderChatPage({ children: <CaptureAgentSelection /> });

		await vi.waitFor(() => {
			const options = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(options?.defaultModel).toEqual({
				providerID: "anthropic",
				modelID: "claude-sonnet",
			});
			expect(options?.variant).toBe("high");
		});

		act(() => agentSelection.setAgent("plan"));
		await vi.waitFor(() => {
			const options = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(options?.defaultModel).toEqual({
				providerID: "anthropic",
				modelID: "claude-opus",
			});
			expect(options?.variant).toBe("max");
		});

		act(() => agentSelection.setAgent("code"));
		await vi.waitFor(() => {
			const options = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(options?.defaultModel).toEqual({
				providerID: "anthropic",
				modelID: "claude-sonnet",
			});
			expect(options?.variant).toBe("high");
		});
	});

	it("does not prepare a local model on select and still passes prepareModel to the runtime", async () => {
		vi.mocked(useKiloModelCatalog).mockReturnValue({
			data: {
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
			isPending: false,
			isError: false,
		} as never);
		const prepareModel = vi.fn(async () => undefined);
		let selectModel!: ReturnType<typeof useChatModelSelection>["setModel"];
		function CaptureModelControls() {
			selectModel = useChatModelSelection().setModel;
			return null;
		}

		renderChatPage({
			getConnection: async () => connection,
			prepareModel,
			children: <CaptureModelControls />,
		});
		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());

		selectModel({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" });
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(prepareModel).not.toHaveBeenCalled();
		expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].prepareModel).toBeTypeOf("function");
	});

	it("starts local inference and refreshes the provider catalog from model selection", async () => {
		const connectLocalInference = vi.fn(async () => undefined);
		let startLocalInference: (() => Promise<void>) | undefined;
		function CaptureLocalInferenceControls() {
			startLocalInference = useChatModelSelection().startLocalInference;
			return null;
		}
		const { queryClient } = renderChatPage({
			getConnection: async () => connection,
			connectLocalInference,
			children: <CaptureLocalInferenceControls />,
		});
		const key = [...KILO_PROVIDER_LIST_QUERY_KEY, connection.baseUrl, connection.version];
		queryClient.setQueryData(key, { providers: [], models: [], defaults: {} });
		await vi.waitFor(() => expect(startLocalInference).toBeTypeOf("function"));

		await act(async () => startLocalInference?.());

		expect(connectLocalInference).toHaveBeenCalledOnce();
		expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
	});

	it("refetches the Kilo catalog when local models change", async () => {
		const { queryClient, localInference } = renderChatPage({
			getConnection: async () => connection,
		});
		const key = [...KILO_PROVIDER_LIST_QUERY_KEY, connection.baseUrl, connection.version];
		queryClient.setQueryData(key, { providers: [], models: [], defaults: {} });

		localInference.events.emit("models-changed");

		await vi.waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
	});

	it("refetches the Kilo catalog when Kilo becomes ready on a new endpoint", async () => {
		const { queryClient, kiloServer } = renderChatPage({
			getConnection: async () => connection,
		});
		const key = [...KILO_PROVIDER_LIST_QUERY_KEY, connection.baseUrl, connection.version];
		queryClient.setQueryData(key, { providers: [], models: [], defaults: {} });
		await vi.waitFor(() => expect(vi.mocked(useKiloRuntime)).toHaveBeenCalled());
		await expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).resolves.toEqual(
			connection,
		);

		kiloServer.events.emit("server-status-changed", {
			status: "ready",
			baseUrl: "http://127.0.0.1:56049",
			version: connection.version,
		});

		await vi.waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
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

	it("keeps the thread mounted when the connection fails", async () => {
		const { baseElement } = renderChatPage({
			getConnection: async () => {
				throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
			},
		});
		const screen = page.elementLocator(baseElement);

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

	it("does not refetch the connection for the cold-start ready event", async () => {
		let resolveConnection!: (value: KiloGlobalConnection) => void;
		const getConnection = vi.fn(
			() =>
				new Promise<KiloGlobalConnection>((resolve) => {
					resolveConnection = resolve;
				}),
		);
		const { kiloServer } = renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		kiloServer.events.emit("server-status-changed", {
			status: "ready",
			baseUrl: connection.baseUrl,
			version: connection.version,
		});
		resolveConnection(connection);

		await expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).resolves.toEqual(
			connection,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(getConnection).toHaveBeenCalledOnce();
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

	it("does not refresh the global connection when local model preparation fails", async () => {
		const getConnection = vi.fn<KiloUiChatService["chat.getConnection"]>(async () => connection);
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalled());
		const initialRuntimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
		const callsBefore = getConnection.mock.calls.length;
		const promiseBefore = initialRuntimeOptions!.connectionPromise;

		initialRuntimeOptions!.onError!(new Error("The local model could not be prepared."));
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(getConnection.mock.calls.length).toBe(callsBefore);
		expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).toBe(promiseBefore);
	});

	it("refreshes the global connection when Kilo restarts on a new endpoint", async () => {
		const refreshedConnection = {
			...connection,
			baseUrl: "http://127.0.0.1:56049",
		};
		const getConnection = vi
			.fn<KiloUiChatService["chat.getConnection"]>()
			.mockResolvedValueOnce(connection)
			.mockResolvedValue(refreshedConnection);
		const { kiloServer } = renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		const initialPromise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
		await expect(initialPromise).resolves.toEqual(connection);

		kiloServer.events.emit("server-status-changed", {
			status: "ready",
			baseUrl: refreshedConnection.baseUrl,
			version: refreshedConnection.version,
		});

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledTimes(2));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(getConnection).toHaveBeenCalledTimes(2);
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).not.toBe(
				initialPromise,
			),
		);
		await expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).resolves.toEqual(
			refreshedConnection,
		);
	});

	it("refreshes the global connection when Kilo rotates credentials on the same endpoint", async () => {
		const refreshedConnection = {
			...connection,
			password: "rotated-secret",
		};
		const getConnection = vi
			.fn<KiloUiChatService["chat.getConnection"]>()
			.mockResolvedValueOnce(connection)
			.mockResolvedValue(refreshedConnection);
		const { kiloServer } = renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		const initialPromise = vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise;
		await expect(initialPromise).resolves.toEqual(connection);

		kiloServer.events.emit("server-status-changed", {
			status: "ready",
			baseUrl: connection.baseUrl,
			version: connection.version,
		});

		await vi.waitFor(() => expect(getConnection.mock.calls.length).toBeGreaterThan(1));
		await vi.waitFor(() =>
			expect(vi.mocked(useKiloRuntime).mock.lastCall?.[0].connectionPromise).not.toBe(
				initialPromise,
			),
		);
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

	it("keeps a new chat as a plain thread without legacy sidebar controls", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-toggle")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("chat-right-panel-empty")).not.toBeInTheDocument();
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-arrangement']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-toolbar']")).toBeNull();
	});

	it("hides the header divider only until the chat has a canvas", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage({
			children: (
				<header data-qa-id="shell-page-header" className="border-border border-b">
					<ChatPageHeaderLeading />
				</header>
			),
		});
		const header = baseElement.querySelector<HTMLElement>('[data-qa-id="shell-page-header"]')!;

		await vi.waitFor(() => expect(header.querySelector("[data-chat-empty]")).not.toBeNull());
		expect(getComputedStyle(header).borderBottomColor).toBe("rgba(0, 0, 0, 0)");

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await vi.waitFor(() => expect(header.querySelector("[data-chat-empty]")).toBeNull());
		expect(getComputedStyle(header).borderBottomColor).not.toBe("rgba(0, 0, 0, 0)");
	});

	it("moves a submitted new chat into the pane canvas", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-arrangement")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-toolbar")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "tiles");
		await expect
			.element(screen.getByTestId("chat-pane-arrangement"))
			.toHaveAttribute("aria-pressed", "false");
		expect(document.querySelector("[data-qa-id='chat-pane-carousel-hint']")).toBeNull();

		await screen.getByTestId("chat-pane-arrangement-carousel").click();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
		await expect
			.element(screen.getByTestId("chat-pane-arrangement"))
			.toHaveAttribute("aria-pressed", "true");
		await screen.getByTestId("chat-pane-toolbar").hover();
		await screen.getByTestId("chat-pane-arrangement").hover();
		await expect
			.poll(() => document.querySelector("[data-slot='tooltip-content']")?.textContent)
			.toBe("Carousel · Shift + scroll to pan");

		await screen.getByTestId("chat-pane-arrangement-carousel").click();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "tiles");
		await expect
			.element(screen.getByTestId("chat-pane-arrangement"))
			.toHaveAttribute("aria-pressed", "false");
	});

	it("keeps contributed panes mounted while a submitted chat promotes to its remote session id", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		useRightPanelStore.getState().openTab("draft", { id: "canvas.canvas", title: "Canvas" });
		rerenderChatPage();

		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();
		const before = baseElement.querySelector("[data-qa-id='test-canvas-panel']");
		expect(before).not.toBeNull();

		// The remote session id resolves one commit before the store move carries
		// the draft's panes over; the pane content must not unmount in that gap.
		assistantState.current.threadListItem.remoteId = "session-1";
		rerenderChatPage();

		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='test-canvas-panel']")).toBe(before);
		expect(useRightPanelStore.getState().bySessionId.draft).toBeUndefined();
		expect(
			useRightPanelStore.getState().bySessionId["session-1"]?.tabs.map(({ title }) => title),
		).toEqual(["Canvas 1"]);
	});

	it("expands a pane to fill the canvas without leaving the current arrangement", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const artifact = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		await expect.element(screen.getByTestId("chat-pane-expand-agent:draft")).toBeVisible();

		await screen.getByTestId("chat-pane-arrangement-carousel").click();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
		await screen.getByTestId("kilo-chat-pane-canvas").hover();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		await expect.element(screen.getByTestId(`chat-pane-${artifact.instanceId}`)).toBeVisible();

		await screen.getByTestId(`chat-pane-tab-${artifact.instanceId}`).click({ force: true });
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${artifact.instanceId}`))
			.toHaveAttribute("aria-selected", "true");
		const expand = screen.getByTestId(`chat-pane-expand-${artifact.instanceId}`);
		await expect.element(expand).toBeVisible();
		await expand.click({ force: true });
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-expanded", "true");
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-arrangement", "carousel");
		await expect.element(screen.getByTestId(`chat-pane-${artifact.instanceId}`)).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).not.toBeVisible();

		await screen.getByTestId(`chat-pane-expand-${artifact.instanceId}`).click();
		await screen.getByTestId("chat-pane-tab-agent:draft").click({ force: true });
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-expanded", "false");
		await expect.element(screen.getByTestId(`chat-pane-${artifact.instanceId}`)).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-carousel-track")).toBeVisible();
	});

	it("opens only the chat pane when a workspace draft is submitted", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toBeUndefined();

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		expect(
			baseElement.querySelector(`[data-qa-id='chat-pane-${FILES_EXPLORER_PANE_ID}']`),
		).toBeNull();
		await expect.element(screen.getByTestId("chat-pane-title")).not.toBeInTheDocument();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("opens workspace files into a group beside the files explorer", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		openWorkspaceFilesExplorer();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`))
			.toBeVisible();

		useRightPanelStore.getState().openTab(
			"draft",
			{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
			{
				instanceId: `file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/readme.md`,
				title: "readme.md",
				metadata: {
					explorerId: FILES_EXPLORER_PANE_ID,
					workspaceDirectory: "/projects/workspace-1",
					relativePath: "readme.md",
				},
			},
		);
		useRightPanelStore.getState().openTab(
			"draft",
			{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
			{
				instanceId: `file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/notes.md`,
				title: "notes.md",
				metadata: {
					explorerId: FILES_EXPLORER_PANE_ID,
					workspaceDirectory: "/projects/workspace-1",
					relativePath: "notes.md",
				},
			},
		);

		await expect
			.element(
				screen.getByTestId(
					`chat-pane-tab-file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/readme.md`,
				),
			)
			.toBeVisible();
		await expect
			.element(
				screen.getByTestId(
					`chat-pane-tab-file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/notes.md`,
				),
			)
			.toBeVisible();

		const explorerGroup = baseElement
			.querySelector(`[data-pane-tab='${FILES_EXPLORER_PANE_ID}']`)
			?.closest("[data-pane-group-id]");
		const readmeGroup = baseElement
			.querySelector(
				`[data-pane-tab='file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/readme.md']`,
			)
			?.closest("[data-pane-group-id]");
		const notesGroup = baseElement
			.querySelector(
				`[data-pane-tab='file:${FILES_EXPLORER_PANE_ID}:/projects/workspace-1/notes.md']`,
			)
			?.closest("[data-pane-group-id]");
		expect(readmeGroup).not.toBe(explorerGroup);
		expect(notesGroup).toBe(readmeGroup);
		expect(readmeGroup?.querySelectorAll("[data-pane-tab]")).toHaveLength(2);
	});

	it("groups sequential workspace files even without explorerId metadata", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		openWorkspaceFilesExplorer();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`))
			.toBeVisible();

		useRightPanelStore.getState().openTab(
			"draft",
			{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
			{
				instanceId: "file:/projects/workspace-1/readme.md",
				title: "readme.md",
				metadata: {
					workspaceDirectory: "/projects/workspace-1",
					relativePath: "readme.md",
				},
			},
		);
		await expect
			.element(screen.getByTestId("chat-pane-tab-file:/projects/workspace-1/readme.md"))
			.toBeVisible();

		useRightPanelStore.getState().openTab(
			"draft",
			{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
			{
				instanceId: "file:/projects/workspace-1/notes.md",
				title: "notes.md",
				metadata: {
					workspaceDirectory: "/projects/workspace-1",
					relativePath: "notes.md",
				},
			},
		);

		await expect
			.element(screen.getByTestId("chat-pane-tab-file:/projects/workspace-1/readme.md"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("chat-pane-tab-file:/projects/workspace-1/notes.md"))
			.toBeVisible();

		const explorerGroup = baseElement
			.querySelector(`[data-pane-tab='${FILES_EXPLORER_PANE_ID}']`)
			?.closest("[data-pane-group-id]");
		const readmeGroup = baseElement
			.querySelector("[data-pane-tab='file:/projects/workspace-1/readme.md']")
			?.closest("[data-pane-group-id]");
		const notesGroup = baseElement
			.querySelector("[data-pane-tab='file:/projects/workspace-1/notes.md']")
			?.closest("[data-pane-group-id]");
		expect(readmeGroup).not.toBe(explorerGroup);
		expect(notesGroup).toBe(readmeGroup);
		expect(readmeGroup?.querySelectorAll("[data-pane-tab]")).toHaveLength(2);
	});

	it("opens a second files explorer into the same tab group", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		openWorkspaceFilesExplorer();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`))
			.toBeVisible();

		await screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`).click();
		await clickAddTab(baseElement);
		await page.getByTestId("chat-pane-add-menu-files.files").click();

		const explorers = useRightPanelStore
			.getState()
			.bySessionId.draft!.tabs.filter(
				(tab) =>
					tab.definitionId === FILES_PANE_DEFINITION_ID && tab.metadata?.relativePath == null,
			);
		expect(explorers).toHaveLength(2);
		const secondId = explorers.find((tab) => tab.instanceId !== FILES_EXPLORER_PANE_ID)!.instanceId;
		await expect.element(screen.getByTestId(`chat-pane-tab-${secondId}`)).toBeVisible();
		const firstGroup = baseElement
			.querySelector(`[data-pane-tab='${FILES_EXPLORER_PANE_ID}']`)
			?.closest("[data-pane-group-id]");
		const secondGroup = baseElement
			.querySelector(`[data-pane-tab='${secondId}']`)
			?.closest("[data-pane-group-id]");
		expect(secondGroup).toBe(firstGroup);
		expect(firstGroup?.querySelectorAll("[data-pane-tab]")).toHaveLength(2);
	});

	it("does not open files when submitting an unscoped new chat", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage({ contributeFiles: true });
		const screen = page.elementLocator(baseElement);

		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("does not auto-open files when opening an existing workspace session", async () => {
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		const { baseElement } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-agent:draft")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("returns to the empty chat page when starting a new chat after a workspace submit", async () => {
		const { baseElement, queryClient, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();
		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		openWorkspaceFilesExplorer();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`))
			.toBeVisible();

		assistantState.current.thread.messages = [];
		assistantState.current.thread.isEmpty = true;
		assistantState.current.threadListItem.remoteId = undefined;
		assistantState.current.threadListItem.status = "new";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("shows the empty new-chat page when New is pressed from a workspace canvas", async () => {
		assistantState.current.thread.messages = [{ role: "user" }];
		assistantState.current.thread.isEmpty = false;
		assistantState.current.threadListItem.remoteId = "session-1";
		assistantState.current.threadListItem.status = "regular";
		useRightPanelStore
			.getState()
			.openTab(
				"session-1",
				{ id: FILES_PANE_DEFINITION_ID, title: "Files" },
				{ instanceId: FILES_EXPLORER_PANE_ID },
			);
		const { baseElement, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${FILES_EXPLORER_PANE_ID}`))
			.toBeVisible();

		assistantState.current.thread.messages = [];
		assistantState.current.thread.isEmpty = true;
		assistantState.current.threadListItem.status = "new";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
	});

	it("does not open files when a new chat leaves draft status before the first message", async () => {
		const { baseElement, rerenderChatPage } = renderChatPage({
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
			contributeFiles: true,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();

		assistantState.current.threadListItem.status = "regular";
		rerenderChatPage();

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-pane-canvas']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='test-files-panel']")).toBeNull();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs ?? []).toEqual([]);
	});

	it("opens a files explorer from the plus tab into the current tab group", async () => {
		const { baseElement } = renderChatPage({ contributeFiles: true });
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const canvasTab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		await expect.element(screen.getByTestId(`chat-pane-tab-${canvasTab.instanceId}`)).toBeVisible();

		await clickAddTab(baseElement);
		await page.getByTestId("chat-pane-add-menu-files.files").click();

		const filesTab = useRightPanelStore
			.getState()
			.bySessionId.draft!.tabs.find(
				(tab) =>
					tab.definitionId === FILES_PANE_DEFINITION_ID && tab.metadata?.relativePath == null,
			);
		expect(filesTab).toBeDefined();
		await expect.element(screen.getByTestId(`chat-pane-tab-${filesTab!.instanceId}`)).toBeVisible();
		const canvasGroup = baseElement
			.querySelector(`[data-pane-tab='${canvasTab.instanceId}']`)
			?.closest("[data-pane-group-id]");
		const filesGroup = baseElement
			.querySelector(`[data-pane-tab='${filesTab!.instanceId}']`)
			?.closest("[data-pane-group-id]");
		expect(filesGroup).toBe(canvasGroup);
		expect(canvasGroup?.querySelectorAll("[data-pane-tab]")).toHaveLength(2);
	});

	it("opens a contributed pane from the plus tab beside existing tabs", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		await expect.element(screen.getByTestId("test-canvas-panel")).toHaveTextContent("Canvas 1");
		const firstTab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		await expect.element(screen.getByTestId(`chat-pane-tab-${firstTab.instanceId}`)).toBeVisible();
		await expect.element(page.elementLocator(addTabInActiveGroup(baseElement)!)).toBeVisible();

		await clickAddTab(baseElement);
		await expect.element(page.getByTestId("chat-pane-add-menu-chat")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("chat-pane-add-menu-canvas.canvas")).toBeVisible();
		await page.getByTestId("chat-pane-add-menu-canvas.canvas").click();
		const secondTab = useRightPanelStore.getState().bySessionId.draft!.tabs[1]!;
		await expect.element(screen.getByTestId(`chat-pane-tab-${secondTab.instanceId}`)).toBeVisible();
		const firstGroup = baseElement
			.querySelector(`[data-pane-tab='${firstTab.instanceId}']`)
			?.closest("[data-pane-group-id]");
		const secondGroup = baseElement
			.querySelector(`[data-pane-tab='${secondTab.instanceId}']`)
			?.closest("[data-pane-group-id]");
		expect(secondGroup).toBe(firstGroup);
		expect(firstGroup?.querySelectorAll("[data-pane-tab]")).toHaveLength(2);
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs.map(({ title }) => title)).toEqual(
			["Canvas 1", "Canvas 2"],
		);

		await screen.getByTestId(`chat-pane-tab-${firstTab.instanceId}`).click();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${firstTab.instanceId}`))
			.toHaveAttribute("aria-selected", "true");
	});

	it("pops a pane into a window while retaining its in-canvas empty state", async () => {
		const openPaneWindow = vi.fn(async () => ({ opened: true }));
		const focusPaneWindow = vi.fn(async () => ({ focused: true }));
		const dockPaneWindow = vi.fn(async () => ({ docked: true }));
		const { baseElement } = renderChatPage({
			shell: { openPaneWindow, focusPaneWindow, dockPaneWindow },
			workspaces: [workspace],
			activeWorkspaceId: workspace.id,
		});
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		await screen.getByTestId(`chat-pane-pop-out-tab-${tab.instanceId}`).click();

		expect(openPaneWindow).toHaveBeenCalledWith({
			pluginId: "kilo-ui",
			sessionId: "draft",
			paneId: tab.instanceId,
			title: tab.title,
			path: "/plugins/chat",
			workspaceId: workspace.id,
		});
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${tab.instanceId}`))
			.toHaveAttribute("data-popped-out", "true");
		expect(baseElement.querySelector("[data-qa-id='test-canvas-panel']")).toBeNull();

		await screen.getByTestId(`chat-pane-tab-${tab.instanceId}`).click();
		await expect
			.element(screen.getByTestId(`chat-pane-popped-out-${tab.instanceId}`))
			.toBeVisible();
		expect(focusPaneWindow).not.toHaveBeenCalled();

		await screen.getByRole("button", { name: "Bring to front" }).click();
		expect(focusPaneWindow).toHaveBeenCalledWith({
			pluginId: "kilo-ui",
			sessionId: "draft",
			paneId: tab.instanceId,
		});

		await screen.getByTestId(`chat-pane-dock-tab-${tab.instanceId}`).click();
		expect(dockPaneWindow).toHaveBeenCalledWith({
			pluginId: "kilo-ui",
			sessionId: "draft",
			paneId: tab.instanceId,
		});
		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();
	});

	it("merges pane window events that arrive while the initial window list is loading", async () => {
		assistantState.current.threadListItem.status = "regular";
		useRightPanelStore
			.getState()
			.openTab("draft", { id: "canvas.canvas", title: "Canvas" }, { instanceId: "existing-pane" });
		useRightPanelStore
			.getState()
			.openTab("draft", { id: "canvas.canvas", title: "Canvas" }, { instanceId: "live-pane" });
		let resolveListed!: (value: Awaited<ReturnType<SDK["shell"]["listPaneWindows"]>>) => void;
		const listed = new Promise<Awaited<ReturnType<SDK["shell"]["listPaneWindows"]>>>((resolve) => {
			resolveListed = resolve;
		});
		let notify!: Parameters<SDK["shell"]["onPaneWindowChanged"]>[0];
		const { baseElement } = renderChatPage({
			shell: {
				listPaneWindows: () => listed,
				onPaneWindowChanged: (listener) => {
					notify = listener;
					return () => {};
				},
			},
		});
		const screen = page.elementLocator(baseElement);
		await vi.waitFor(() => expect(notify).toBeTypeOf("function"));

		notify({
			type: "opened",
			pluginId: "kilo-ui",
			sessionId: "draft",
			paneId: "live-pane",
		});
		resolveListed([
			{
				pluginId: "kilo-ui",
				sessionId: "draft",
				paneId: "existing-pane",
				title: "Canvas 1",
				path: "/plugins/chat",
			},
		]);

		await expect
			.element(screen.getByTestId("chat-pane-tab-existing-pane"))
			.toHaveAttribute("data-popped-out", "true");
		await expect
			.element(screen.getByTestId("chat-pane-tab-live-pane"))
			.toHaveAttribute("data-popped-out", "true");
	});

	it("shows a notebook in the main canvas when chat is popped out", async () => {
		assistantState.current.threadListItem.remoteId = "session-1";
		assistantState.current.threadListItem.status = "regular";
		const { baseElement, sdk } = renderChatPage({
			contributeNotebook: true,
			shell: {
				openPaneWindow: async () => ({ opened: true }),
				listPaneWindows: async () => [],
			},
		});
		const screen = page.elementLocator(baseElement);
		const chatPaneId = "agent:session-1";

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		await screen.getByTestId(`chat-pane-pop-out-tab-${chatPaneId}`).click();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${chatPaneId}`))
			.toHaveAttribute("data-popped-out", "true");
		expect(baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']")).toBeNull();

		sdk.events.emit("chat-pane-tab-opened", {
			sessionId: "session-1",
			tab: {
				instanceId: "nb-1",
				definitionId: "notebook.notebook",
				title: "Notebook",
				ordinal: 1,
			},
		});

		await expect.element(screen.getByTestId("test-notebook-panel")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-tab-nb-1")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='test-notebook-panel']")).not.toBeNull();
	});

	it("labels the chat pane pill with the chat title", async () => {
		assistantState.current.threadListItem.remoteId = "session-1";
		assistantState.current.threadListItem.status = "regular";
		assistantState.current.threadListItem.title = "Refactor breadcrumbs";
		let setAgent!: (agent: string) => void;
		function CaptureAgentControls() {
			setAgent = useChatAgentSelection().setAgent;
			return null;
		}
		const { baseElement } = renderChatPage({ children: <CaptureAgentControls /> });
		const screen = page.elementLocator(baseElement);
		const tab = screen.getByTestId("chat-pane-tab-agent:session-1");

		await expect.element(tab).toBeVisible();
		await expect.element(tab).toHaveTextContent("Refactor breadcrumbs");
		expect(tab.element()?.textContent).not.toContain("Code");
		await expect.element(tab).not.toHaveAttribute("title");
		await expect.element(screen.getByTestId("chat-pane-title")).not.toBeInTheDocument();

		setAgent("plan");
		await expect.element(tab).toHaveTextContent("Refactor breadcrumbs");
		expect(tab.element()?.textContent).not.toContain("Plan");
	});

	it("hides and restores the Chat pane without closing its session", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		const chatPaneId = "agent:draft";

		await openFirstCanvasPane(screen);
		await screen.getByTestId(`chat-pane-tab-${chatPaneId}`).hover();
		await screen.getByTestId(`chat-pane-close-tab-${chatPaneId}`).click();

		await expect.element(screen.getByTestId(`chat-pane-tab-${chatPaneId}`)).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();

		await clickAddTab(baseElement);
		await page.getByTestId("chat-pane-add-menu-chat").click();

		await expect.element(screen.getByTestId(`chat-pane-tab-${chatPaneId}`)).toBeVisible();
		await expect
			.element(screen.getByTestId(`chat-pane-tab-${chatPaneId}`))
			.toHaveAttribute("aria-selected", "true");
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});

	it("returns to Chat when the last remaining artifact pane is closed", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		const chatPaneId = "agent:draft";

		await openFirstCanvasPane(screen);
		const artifact = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		await screen.getByTestId(`chat-pane-tab-${chatPaneId}`).hover();
		await screen.getByTestId(`chat-pane-close-tab-${chatPaneId}`).click();
		await screen.getByTestId(`chat-pane-close-tab-${artifact.instanceId}`).click();

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).not.toBeInTheDocument();
	});

	it("shows workspace context and passes workspace folders to a detached pane renderer", async () => {
		assistantState.current.threadListItem.remoteId = "session-1";
		useRightPanelStore
			.getState()
			.openTab("session-1", { id: "canvas.canvas", title: "Detached Canvas" });
		const tab = useRightPanelStore.getState().bySessionId["session-1"]!.tabs[0]!;
		const detachedWorkspace = { ...workspace, color: "#34D399" };
		const { baseElement } = renderChatPage({
			workspaces: [detachedWorkspace],
			pageProps: {
				search: {
					paneWindow: true,
					panePluginId: "kilo-ui",
					paneSessionId: "session-1",
					paneId: tab.instanceId,
					paneWorkspaceId: detachedWorkspace.id,
				},
			},
		});
		const screen = page.elementLocator(baseElement);

		const breadcrumb = screen.getByTestId("detached-pane-breadcrumb");
		await expect.element(screen.getByText("Workspace 1")).toBeVisible();
		const breadcrumbElement = breadcrumb.element();
		expect(breadcrumbElement.textContent).toContain("Workspace 1");
		expect(breadcrumbElement.textContent).toContain("Detached Canvas");
		expect(breadcrumbElement.querySelector("svg")?.style.color).toBe("rgb(52, 211, 153)");
		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-directory", "/projects/workspace-1");
		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-folders", "/projects/workspace-1");
		const detachedContent = baseElement.querySelector(
			`[data-qa-id='chat-pane-content-${tab.instanceId}']`,
		);
		expect(detachedContent?.getBoundingClientRect().height).toBeGreaterThan(100);
	});

	it("opens a contributed pane from the header launch toolbar", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		await expect.element(screen.getByTestId("chat-pane-toolbar")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-arrangement")).toBeVisible();

		await screen.getByTestId("chat-pane-toolbar-add").click();
		await screen.getByTestId("chat-pane-launch-canvas.canvas").click();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs.map(({ title }) => title)).toEqual(
			["Canvas 1", "Canvas 2"],
		);
	});

	it("keeps Chat separate in the header toolbar and reveals its existing pane", async () => {
		assistantState.current.threadListItem.status = "regular";
		const store = useRightPanelStore.getState();
		store.openTab("draft", { id: "canvas.canvas", title: "Canvas" });
		store.openTab("draft", { id: "canvas.canvas", title: "Canvas" });
		store.setArrangement("draft", "carousel");
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		const track = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-carousel-track']");

		expect(track).toBeTruthy();
		if (!track) return;
		await vi.waitFor(() => {
			expect(track.scrollWidth).toBeGreaterThan(track.clientWidth + 100);
		});

		const addControl = screen.getByTestId("chat-pane-toolbar-add");
		await expect.element(addControl).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-launch-chat")).toBeVisible();
		await addControl.click();
		await expect.element(screen.getByTestId("chat-pane-launch-canvas.canvas")).toBeVisible();

		await addControl.click();
		await screen.getByTestId("chat-pane-launch-chat").click({ force: true });
		await expect
			.element(screen.getByTestId("chat-pane-tab-agent:draft"))
			.toHaveAttribute("aria-selected", "true");
		expect(baseElement.querySelectorAll("[data-pane-tab][data-pane-kind='agent']")).toHaveLength(1);
		await vi.waitFor(() => expect(track.scrollLeft).toBeLessThan(50));

		track.dispatchEvent(
			new WheelEvent("wheel", { deltaX: 240, deltaY: 0, bubbles: true, cancelable: true }),
		);
		track.scrollLeft = track.scrollWidth - track.clientWidth;
		expect(track.scrollLeft).toBeGreaterThan(100);
		await screen.getByTestId("chat-pane-launch-chat").click({ force: true });
		await vi.waitFor(() => expect(track.scrollLeft).toBeLessThan(50));
	});

	it("offers a Carousel toggle instead of named layout modes", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		await expect.element(screen.getByTestId("chat-pane-arrangement")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-arrangement-carousel")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-arrangement-tiles']")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-arrangement-tabs']")).toBeNull();
	});

	it("unpins every column when Carousel is turned off", async () => {
		assistantState.current.threadListItem.status = "regular";
		const store = useRightPanelStore.getState();
		store.openTab("draft", { id: "canvas.canvas", title: "Canvas" });
		store.setArrangement("draft", "carousel");
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-pane-canvas")).toBeVisible();
		const agentGroup = baseElement
			.querySelector("[data-pane-tab][data-pane-kind='agent']")
			?.closest<HTMLElement>("[data-pane-group-id]");
		const pin = agentGroup?.querySelector<HTMLElement>("[data-qa-id^='chat-pane-pin-']");
		expect(pin).toBeTruthy();
		await page.elementLocator(pin!).click();
		await vi.waitFor(() => {
			const stored = useRightPanelStore.getState().bySessionId.draft?.layoutJson;
			expect(
				stored && JSON.parse(stored).groups.some((group: { pinned: boolean }) => group.pinned),
			).toBe(true);
		});

		await screen.getByTestId("chat-pane-arrangement-carousel").click();
		await vi.waitFor(() => {
			const session = useRightPanelStore.getState().bySessionId.draft;
			expect(session?.arrangement).toBe("tiles");
			expect(
				session?.layoutJson &&
					JSON.parse(session.layoutJson).groups.every(
						(group: { pinned: boolean }) => !group.pinned,
					),
			).toBe(true);
		});
	});

	it("keeps an inactive dirty contribution mounted", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const firstTab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		chatRightPanelCapability.updateTab("draft", firstTab.instanceId, { dirty: true });

		await launchCanvasFromAddTab(baseElement);
		await vi.waitFor(() => {
			expect(baseElement.querySelectorAll("[data-qa-id='test-canvas-panel']")).toHaveLength(2);
		});
	});

	it("uses a contributed pane icon in the tab strip", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;

		const icon = baseElement.querySelector(
			`[data-qa-id='chat-pane-tab-${tab.instanceId}'] .lucide-hammer`,
		);
		expect(icon).toBeTruthy();
		expect(icon).not.toHaveClass("text-chart-2");
	});

	it("shows a close dialog and keeps the tab after Save is cancelled", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		const save = vi.fn(async () => ({ outcome: "cancelled" as const }));
		const discard = vi.fn(async () => undefined);
		const unregister = chatRightPanelCapability.registerTabLifecycle("draft", tab.instanceId, {
			save,
			discard,
		});
		chatRightPanelCapability.updateTab("draft", tab.instanceId, { dirty: true });

		await screen.getByTestId(`chat-pane-close-tab-${tab.instanceId}`).click();
		await expect.element(screen.getByTestId("chat-pane-close-dialog")).toBeVisible();

		await screen.getByTestId("chat-pane-close-save").click();
		await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("chat-pane-close-dialog")).toBeVisible();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);

		await screen.getByTestId("chat-pane-close-discard").click();
		await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("chat-pane-close-dialog")).not.toBeInTheDocument();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
		unregister();
	});

	it("offers Discard and Cancel when a dirty tab has no save handler", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		chatRightPanelCapability.updateTab("draft", tab.instanceId, { dirty: true });

		await screen.getByTestId(`chat-pane-close-tab-${tab.instanceId}`).click();

		await expect.element(screen.getByTestId("chat-pane-close-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-close-save")).not.toBeInTheDocument();
		await screen.getByTestId("chat-pane-close-cancel").click();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
	});

	it("disables close actions while pending and retains the tab after lifecycle failures", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await openFirstCanvasPane(screen);
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
		chatRightPanelCapability.updateTab("draft", tab.instanceId, { dirty: true });
		await screen.getByTestId(`chat-pane-close-tab-${tab.instanceId}`).click();

		await screen.getByTestId("chat-pane-close-save").click();
		await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("chat-pane-close-save")).toBeDisabled();
		await expect.element(screen.getByTestId("chat-pane-close-discard")).toBeDisabled();
		await expect.element(screen.getByTestId("chat-pane-close-cancel")).toBeDisabled();
		resolveSave({ outcome: "failed", reason: "Save failed" });

		await expect
			.element(screen.getByTestId("chat-pane-close-error"))
			.toHaveTextContent("Save failed");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
		await screen.getByTestId("chat-pane-close-discard").click();
		await expect
			.element(screen.getByTestId("chat-pane-close-error"))
			.toHaveTextContent("Discard cleanup failed");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(1);
		unregister();
	});

	it("closes a clean tab without prompting", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		const onClose = vi.fn(async () => undefined);
		const unregister = chatRightPanelCapability.registerTabLifecycle("draft", tab.instanceId, {
			onClose,
		});

		await screen.getByTestId(`chat-pane-close-tab-${tab.instanceId}`).click();

		await expect.element(screen.getByTestId("chat-pane-close-dialog")).not.toBeInTheDocument();
		await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
		unregister();
	});

	it("removes a clean tab immediately and reports background cleanup failures", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);
		await openFirstCanvasPane(screen);
		const tab = useRightPanelStore.getState().bySessionId.draft!.tabs[0]!;
		let rejectClose!: (error: Error) => void;
		const onClose = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectClose = reject;
				}),
		);
		const unregister = chatRightPanelCapability.registerTabLifecycle("draft", tab.instanceId, {
			onClose,
		});

		await screen.getByTestId(`chat-pane-close-tab-${tab.instanceId}`).click();
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
		await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());

		rejectClose(new Error("Terminal shutdown failed"));
		await expect
			.element(screen.getByTestId("chat-pane-lifecycle-close-error"))
			.toHaveTextContent("Terminal shutdown failed");
		expect(useRightPanelStore.getState().bySessionId.draft?.tabs).toHaveLength(0);
		unregister();
	});

	it("keeps an existing tab closeable when its contributing plugin disappears", async () => {
		const { baseElement, removeCanvasContribution } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		await expect.element(screen.getByTestId("test-canvas-panel")).toBeVisible();

		removeCanvasContribution();
		await expect.element(screen.getByTestId("chat-pane-contribution-unavailable")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id^='chat-pane-close-tab-']")).toBeTruthy();
	});

	it("shows the plan pane when openPlan is called for the session", async () => {
		assistantState.current.threadListItem.status = "regular";
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		useRightPanelStore.getState().openPlan("draft");

		await expect.element(screen.getByTestId("chat-pane-tab-plan")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-plan-empty")).toBeVisible();
	});

	it("keeps the same thread instance when opening an artifact pane", async () => {
		const { baseElement } = renderChatPage();
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);
		const instanceBefore = baseElement
			.querySelector("[data-qa-id='kilo-chat-thread-mock']")
			?.getAttribute("data-thread-instance");
		expect(instanceBefore).toBeTruthy();

		await launchCanvasFromAddTab(baseElement);
		await vi.waitFor(() => {
			expect(
				baseElement.querySelectorAll("[data-qa-id='test-canvas-panel']").length,
			).toBeGreaterThan(1);
		});

		expect(
			baseElement
				.querySelector("[data-qa-id='kilo-chat-thread-mock']")
				?.getAttribute("data-thread-instance"),
		).toBe(instanceBefore);
	});

	it("passes all of the draft chat's workspace folders to pane contributions", async () => {
		const multiFolderWorkspace: Workspace = {
			...workspace,
			folders: [
				...workspace.folders,
				{
					id: "folder-2",
					path: "/projects/reference",
					isPrimary: false,
					position: 1,
				},
			],
		};
		localStorage.setItem("kilo-ui.active-workspace", multiFolderWorkspace.id);
		const { baseElement } = renderChatPage({ workspaces: [multiFolderWorkspace] });
		const screen = page.elementLocator(baseElement);

		await openFirstCanvasPane(screen);

		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-directory", "/projects/workspace-1");
		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-folders", "/projects/workspace-1|/projects/reference");
	});

	it("roots right-panel contributions and file links at a worktree session's directory", async () => {
		assistantState.current.threadListItem.remoteId = "session-42";
		assistantState.current.threadListItem.status = "regular";
		const multiFolderWorkspace: Workspace = {
			...workspace,
			folders: [
				...workspace.folders,
				{
					id: "folder-2",
					path: "/projects/reference",
					isPrimary: false,
					position: 1,
				},
			],
		};
		localStorage.setItem("kilo-ui.active-workspace", multiFolderWorkspace.id);
		const { baseElement } = renderChatPage({
			workspaces: [multiFolderWorkspace],
			children: (
				<StampSessionActivity
					sessions={[
						{
							id: "session-42",
							directory: "/repo/.kilo/worktrees/kilo-x",
							workspaceId: multiFolderWorkspace.id,
							worktreeBranch: "kilo/x",
						},
					]}
				/>
			),
		});
		useRightPanelStore.getState().openTab("session-42", { id: "canvas.canvas", title: "Canvas" });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-directory", "/repo/.kilo/worktrees/kilo-x");
		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute(
				"data-workspace-folders",
				"/repo/.kilo/worktrees/kilo-x|/projects/reference",
			);
	});

	it("tells other plugins which folders a background session may open", async () => {
		const { sdk } = renderChatPage({
			workspaces: [workspace],
			children: (
				<StampSessionActivity
					sessions={[
						{
							id: "background-session",
							directory: "/repo/.kilo/worktrees/kilo-y",
							workspaceId: workspace.id,
							worktreeBranch: "kilo/y",
						},
					]}
				/>
			),
		});
		const sessionWorkspace = () =>
			sdk.plugins.get<ChatSessionWorkspaceCapabilities>("kilo-ui")?.chatSessionWorkspace;

		await vi.waitFor(() => {
			expect(sessionWorkspace()?.getFolders("background-session")).toEqual([
				{ path: "/repo/.kilo/worktrees/kilo-y", isPrimary: true },
			]);
		});
		expect(sessionWorkspace()?.resolvePath("background-session", "src/app.ts")).toEqual({
			workspaceDirectory: "/repo/.kilo/worktrees/kilo-y",
			relativePath: "src/app.ts",
		});
		expect(
			sessionWorkspace()?.resolvePath("background-session", "/projects/workspace-1/a.ts"),
		).toBeNull();
	});

	it("keeps the workspace root for non-worktree sessions", async () => {
		assistantState.current.threadListItem.remoteId = "session-43";
		assistantState.current.threadListItem.status = "regular";
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		const { baseElement } = renderChatPage({
			workspaces: [workspace],
			children: (
				<StampSessionActivity
					sessions={[
						{
							id: "session-43",
							directory: "/projects/workspace-1",
							workspaceId: workspace.id,
							worktreeBranch: null,
						},
					]}
				/>
			),
		});
		useRightPanelStore.getState().openTab("session-43", { id: "canvas.canvas", title: "Canvas" });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-directory", "/projects/workspace-1");
		await expect
			.element(screen.getByTestId("test-canvas-panel"))
			.toHaveAttribute("data-workspace-folders", "/projects/workspace-1");
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
