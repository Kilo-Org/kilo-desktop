import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
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
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	};
});

vi.mock("./runtime/use-kilo-runtime.js", () => ({
	useKiloRuntime: vi.fn(() => ({})),
}));

vi.mock("./model-selection/use-kilo-model-catalog.js", () => ({
	useKiloModelCatalog: vi.fn(() => ({
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
	const prepareSession = options?.prepareSession ?? (async () => ({ directory: "/tmp/chat" }));
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
	threadMount.nextId = 0;
	vi.clearAllMocks();
});

describe("chat connection context", () => {
	it("returns the nearest connection status", () => {
		const status = {
			isPending: false,
			isError: false,
			error: null,
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

	it("refreshes the global connection after a runtime request fails", async () => {
		const refreshedConnection = {
			...connection,
			baseUrl: "http://127.0.0.1:5432",
			password: "refreshed-secret",
		};
		const getConnection = vi
			.fn<KiloUiChatService["chat.getConnection"]>()
			.mockResolvedValueOnce(connection)
			.mockResolvedValueOnce(refreshedConnection);
		renderChatPage({ getConnection });

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		const initialRuntimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
		expect(initialRuntimeOptions?.onError).toEqual(expect.any(Function));
		await expect(initialRuntimeOptions!.connectionPromise).resolves.toEqual(connection);

		initialRuntimeOptions!.onError!(new Error("Unauthorized"));

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledTimes(2));
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
		const prepareSession = vi.fn(async () => ({ directory: "/tmp/chat" }));
		const { baseElement } = renderChatPage({ getConnection, prepareSession });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		expect(getConnection).toHaveBeenCalledWith(undefined);
		expect(prepareSession).not.toHaveBeenCalled();
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
