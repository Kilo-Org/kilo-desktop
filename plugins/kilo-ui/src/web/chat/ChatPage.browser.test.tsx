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
	type KiloWorkspaceConnection,
} from "../../contracts/chat/schemas.js";
import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { WorkspacesFeatureProvider } from "../workspaces/WorkspacesFeatureProvider.js";
import { ChatConnectionProvider, useChatConnection } from "./ChatConnectionContext.js";
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

const connection: KiloWorkspaceConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	directory: "/tmp/chats/test",
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
	workspaces?: Workspace[];
}) {
	const getConnection = options?.getConnection ?? (async () => connection);
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
					<ChatPage />
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
			getConnection: () => new Promise<KiloWorkspaceConnection>(() => undefined),
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

	it("requests an unscoped chat connection when no workspace is selected", async () => {
		const getConnection = vi.fn(
			async (_input: Parameters<KiloUiChatService["chat.getConnection"]>[0]) => connection,
		);
		const { baseElement } = renderChatPage({ getConnection });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => {
			expect(getConnection).toHaveBeenCalled();
		});
		expect(getConnection).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
				),
			}),
		);
		const firstCallArgs = getConnection.mock.calls.at(0)?.at(0);
		expect(firstCallArgs).not.toHaveProperty("workspaceId");
	});

	it("requests a workspace-scoped chat connection when a workspace is active", async () => {
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		const getConnection = vi.fn(async () => ({
			...connection,
			directory: workspace.folders[0]!.path,
		}));
		const { baseElement } = renderChatPage({
			getConnection,
			workspaces: [workspace],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() => {
			expect(getConnection).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: workspace.id,
				}),
			);
		});
	});

	it("refreshes the chat connection when workspace folders change", async () => {
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		let directory = workspace.folders[0]!.path;
		const getConnection = vi.fn(
			async (_input: Parameters<KiloUiChatService["chat.getConnection"]>[0]) => ({
				...connection,
				directory,
			}),
		);
		const { queryClient, sdk } = renderChatPage({ getConnection, workspaces: [workspace] });
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

		directory = "/projects/workspace-1-new-primary";
		sdk.events.emit("workspace-updated", {
			before: workspace,
			after: {
				...workspace,
				folders: [{ ...workspace.folders[0]!, path: directory }],
				updatedAt: 2,
			},
		});

		await vi.waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ exact: true })),
		);
		await vi.waitFor(() => expect(getConnection).toHaveBeenCalledTimes(2));
		await vi.waitFor(async () => {
			const runtimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(runtimeOptions).toBeDefined();
			await expect(runtimeOptions!.connectionPromise).resolves.toMatchObject({ directory });
		});
	});

	it("keeps the chat thread mounted when the active workspace changes", async () => {
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
		const getConnection = vi.fn(
			async (input: Parameters<KiloUiChatService["chat.getConnection"]>[0]) => ({
				...connection,
				directory:
					input.workspaceId === otherWorkspace.id
						? otherWorkspace.folders[0]!.path
						: workspace.folders[0]!.path,
			}),
		);
		const { baseElement, sdk } = renderChatPage({
			getConnection,
			workspaces: [workspace, otherWorkspace],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await vi.waitFor(() =>
			expect(getConnection).toHaveBeenCalledWith(
				expect.objectContaining({ workspaceId: workspace.id }),
			),
		);

		const threadBefore = baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']");
		const instanceBefore = threadBefore?.getAttribute("data-thread-instance");
		expect(instanceBefore).toBeTruthy();

		sdk.state.register<string | null>("active-workspace", workspace.id).set(otherWorkspace.id);

		await vi.waitFor(() =>
			expect(getConnection).toHaveBeenCalledWith(
				expect.objectContaining({ workspaceId: otherWorkspace.id }),
			),
		);
		await vi.waitFor(async () => {
			const runtimeOptions = vi.mocked(useKiloRuntime).mock.lastCall?.[0];
			expect(runtimeOptions).toBeDefined();
			await expect(runtimeOptions!.connectionPromise).resolves.toMatchObject({
				directory: otherWorkspace.folders[0]!.path,
			});
		});

		const threadAfter = baseElement.querySelector("[data-qa-id='kilo-chat-thread-mock']");
		expect(threadAfter?.getAttribute("data-thread-instance")).toBe(instanceBefore);
	});
});
