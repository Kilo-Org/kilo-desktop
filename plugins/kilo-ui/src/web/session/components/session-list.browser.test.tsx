import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createStaticNavigation, type SDK } from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";

import type { GitPullRequestStatusStoreValue } from "@kilo-desktop/plugin-git/contracts";

import { kiloUiChatContract } from "../../../contracts/chat/schemas.js";
import {
	DEFAULT_WORKSPACE_BOARD,
	placeSession,
	type WorkspaceBoardState,
} from "../../../contracts/workspace-board/board-model.js";
import { workspaceBoardContract } from "../../../contracts/workspace-board/schemas.js";
import { WorkspaceBoardProvider } from "../workspace-board/WorkspaceBoardProvider.js";
import { WORKSPACE_BOARD_ROUTE_PATH } from "../workspace-board/workspace-board-constants.js";
import {
	createWorkspaceBoardBackend,
	workspaceBoardFlags,
} from "../workspace-board/test-helpers.js";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../../workspaces/WorkspacesFeatureContext.js";
import { SessionActivityProvider } from "../activity/SessionActivityProvider.js";
import { SessionPerChatFixture } from "../test-helpers.js";
import { createSessionActivityStore } from "../activity/session-activity-store.js";
import {
	DEFAULT_SESSION_LIST_VIEW,
	SESSION_LIST_VIEW_STORAGE_KEY,
	type SessionListView,
} from "../list/session-list-view.js";
import { SessionListViewProvider } from "../list/use-session-list-view.js";
import { SessionList } from "./session-list.js";
import type { SessionRowMetadataProps } from "./session-row-display.js";

type ToastResult = { message: string; [key: string]: unknown };
const toastApi = vi.hoisted(() => {
	const api = {
		success: vi.fn(),
		error: vi.fn(),
		// Settles like sonner: forwards the resolved state to success/error so
		// tests assert on the final toast the user sees.
		promise: vi.fn(
			(
				job: Promise<unknown>,
				options: { success: (v: unknown) => ToastResult; error: (e: unknown) => ToastResult },
			) => {
				job.then(
					(value) => {
						const { message, ...rest } = options.success(value);
						api.success(message, rest);
					},
					(reason) => {
						const { message, ...rest } = options.error(reason);
						api.error(message, rest);
					},
				);
			},
		),
	};
	return api;
});

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	toast: toastApi,
}));

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

type SeededThread = {
	remoteId: string;
	title: string;
	status?: "regular" | "archived";
};

class SeededThreadListAdapter implements RemoteThreadListAdapter {
	readonly archiveCalls: string[] = [];
	readonly unarchiveCalls: string[] = [];
	readonly renameCalls: { remoteId: string; title: string }[] = [];
	readonly deleteCalls: string[] = [];
	/** When set, `delete` rejects — the server-failure path. */
	deleteError: Error | undefined;
	/** When true, the first page reports more pages that are never loaded. */
	hasMorePages = false;
	private readonly records: Required<SeededThread>[];

	constructor(threads: SeededThread[]) {
		this.records = threads.map((thread) => ({ status: "regular", ...thread }));
	}

	list() {
		return Promise.resolve({
			threads: this.records.map((record) => ({ ...record })),
			...(this.hasMorePages ? { nextCursor: "page-2" } : {}),
		});
	}

	archive(remoteId: string) {
		this.archiveCalls.push(remoteId);
		const record = this.records.find((entry) => entry.remoteId === remoteId);
		if (record) record.status = "archived";
		return Promise.resolve();
	}

	unarchive(remoteId: string) {
		this.unarchiveCalls.push(remoteId);
		const record = this.records.find((entry) => entry.remoteId === remoteId);
		if (record) record.status = "regular";
		return Promise.resolve();
	}

	rename(remoteId: string, newTitle: string) {
		this.renameCalls.push({ remoteId, title: newTitle });
		const record = this.records.find((entry) => entry.remoteId === remoteId);
		if (record) record.title = newTitle;
		return Promise.resolve();
	}

	delete(remoteId: string) {
		this.deleteCalls.push(remoteId);
		if (this.deleteError) return Promise.reject(this.deleteError);
		const index = this.records.findIndex((entry) => entry.remoteId === remoteId);
		if (index >= 0) this.records.splice(index, 1);
		return Promise.resolve();
	}

	initialize(threadId: string) {
		return Promise.resolve({ remoteId: threadId, externalId: undefined });
	}

	generateTitle() {
		return Promise.resolve(
			new ReadableStream({
				start(controller) {
					controller.close();
				},
			}),
		);
	}

	fetch(threadId: string) {
		const record = this.records.find((entry) => entry.remoteId === threadId);
		if (!record) return Promise.reject(new Error(`Thread "${threadId}" not found.`));
		return Promise.resolve({ ...record });
	}
}

const workspacesValue: WorkspacesContextValue = {
	workspaces: [
		{
			id: "ws-1",
			name: "Acme App",
			color: "#F87171",
			folders: [{ id: "folder-1", path: "/repo/acme", isPrimary: true, position: 0 }],
			createdAt: 0,
			updatedAt: 0,
		},
		{
			id: "ws-2",
			name: "Beta",
			folders: [{ id: "folder-2", path: "/repo/beta", isPrimary: true, position: 0 }],
			createdAt: 0,
			updatedAt: 0,
		},
	],
	activeWorkspaceId: null,
	setActiveWorkspaceId: () => undefined,
	isLoading: false,
	isUnavailable: false,
	openCreate: () => undefined,
	openEdit: () => undefined,
	openDelete: () => undefined,
};

function SessionListHarness({
	adapter,
	store,
	system,
	workspaces,
	includeComposer,
	width,
}: {
	adapter: SeededThreadListAdapter;
	store: ReturnType<typeof createSessionActivityStore>;
	system: ReturnType<typeof createFakeFeatureSystem>;
	workspaces: WorkspacesContextValue;
	includeComposer: boolean;
	width: number | undefined;
}) {
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});

	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<SidebarProvider>
					<SessionActivityProvider store={store}>
						<SessionPerChatFixture>
							<WorkspacesContext.Provider value={workspaces}>
								<SessionListViewProvider>
									<div data-qa-id="sidebar-header-actions" />
									<BoardWrapper>
										<div className="flex h-[420px] flex-col" style={{ width }}>
											<SessionList />
										</div>
									</BoardWrapper>
									{includeComposer ? (
										<ComposerPrimitive.Root>
											<ComposerPrimitive.Input aria-label="Test composer" />
										</ComposerPrimitive.Root>
									) : null}
								</SessionListViewProvider>
							</WorkspacesContext.Provider>
						</SessionPerChatFixture>
					</SessionActivityProvider>
				</SidebarProvider>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

/** Always mounted, as in the app: the `workspace-board` flag alone turns the board on. */
function BoardWrapper({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	return (
		<QueryClientProvider client={queryClient}>
			<WorkspaceBoardProvider>{children}</WorkspaceBoardProvider>
		</QueryClientProvider>
	);
}

const boardBackends: ReturnType<typeof createWorkspaceBoardBackend>[] = [];
afterEach(() => {
	for (const backend of boardBackends.splice(0)) backend.dispose();
});

function renderSessionList({
	threads,
	hydrate,
	activeWorkspaceId = null,
	includeComposer = false,
	removeWorktree,
	skipDefaultHydration = false,
	width,
	hasMorePages = false,
	board,
	path = "/",
	shell,
	pullRequests,
}: {
	threads: SeededThread[];
	hydrate?: (store: ReturnType<typeof createSessionActivityStore>) => void;
	activeWorkspaceId?: string | null;
	includeComposer?: boolean;
	removeWorktree?: (input: { directory: string }) => Promise<undefined>;
	/** Mirrors the real startup window: rows render before any session stamp arrives. */
	skipDefaultHydration?: boolean;
	width?: number;
	/** Mirrors background backfill: older session pages have not loaded yet. */
	hasMorePages?: boolean;
	/** Enables the workspace board with this persisted state. */
	board?: WorkspaceBoardState;
	/** The current route, e.g. the board's to have it open. */
	path?: string;
	shell?: Partial<SDK["shell"]>;
	/** Registers git's pull-request status store, as the git plugin does at boot. */
	pullRequests?: GitPullRequestStatusStoreValue;
}) {
	const adapter = new SeededThreadListAdapter(threads);
	adapter.hasMorePages = hasMorePages;
	const navigate = vi.fn();
	const setActiveWorkspaceId = vi.fn();
	const openCreate = vi.fn();
	const openEdit = vi.fn();
	const openDelete = vi.fn();
	const workspaces = {
		...workspacesValue,
		activeWorkspaceId,
		setActiveWorkspaceId,
		openCreate,
		openEdit,
		openDelete,
	};
	const boardBackend = createWorkspaceBoardBackend(board);
	boardBackends.push(boardBackend);
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		navigation: { ...createStaticNavigation({ path, search: {} }), navigate },
		channels: { ...kiloUiChatContract, ...workspaceBoardContract },
		handlers: {
			"chat.removeWorktree": removeWorktree ?? (async () => undefined),
			...boardBackend.handlers,
		},
		featureFlags: workspaceBoardFlags(board !== undefined),
		...(shell ? { shell } : {}),
	});
	const pullRequestStatus = pullRequests
		? sdk.services.stateBroker.register("git", "pull-request-status", pullRequests)
		: undefined;
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	system.getSdk("metadata-probe").contribute("kilo-ui/chat-session-row-metadata", {
		id: "probe",
		label: "PR status",
		component: ({ statusId, interactive }: SessionRowMetadataProps) => (
			<span data-qa-id={`pr-status-${statusId}`} data-interactive={interactive ? "" : undefined}>
				PR #42
			</span>
		),
	});
	const store = createSessionActivityStore({ storage: null });
	if (!skipDefaultHydration) {
		store.getState().hydrateSessions(
			threads.map((thread, index) => ({
				id: thread.remoteId,
				directory: `/repo/${thread.remoteId}`,
				createdAt: 1_700_000_000_000 + index * 1000,
				updatedAt: 1_700_000_000_000 + index * 1000,
			})),
		);
	}
	hydrate?.(store);
	// Settle the refresh flag after all hydration so the delete flow treats
	// the store as authoritative. Tests that exercise the unsettled window
	// use `skipDefaultHydration` and call `markSessionsRefreshed()` manually.
	if (!skipDefaultHydration) {
		store.getState().markSessionsRefreshed();
	}
	const result = render(
		<SessionListHarness
			adapter={adapter}
			store={store}
			system={system}
			workspaces={workspaces}
			includeComposer={includeComposer}
			width={width}
		/>,
	);
	return {
		board: boardBackend.stored,
		adapter,
		navigate,
		openCreate,
		openDelete,
		openEdit,
		setActiveWorkspaceId,
		store,
		pullRequestStatus,
		screen: page.elementLocator(result.baseElement),
		...result,
	};
}

function storeView(view: Partial<SessionListView>) {
	localStorage.setItem(
		SESSION_LIST_VIEW_STORAGE_KEY,
		JSON.stringify({ ...DEFAULT_SESSION_LIST_VIEW, ...view }),
	);
}

function confirmChatDelete() {
	return page.getByTestId("session-delete-confirm").click();
}

function rowSlot(card: ReturnType<typeof page.elementLocator>, slot: string) {
	return card.element().querySelector<HTMLElement>(`[data-slot="aui_session-list-item-${slot}"]`);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	toastApi.success.mockReset();
	toastApi.error.mockReset();
	toastApi.promise.mockClear();
});

describe("SessionList", () => {
	it("keeps a large session history reachable without mounting offscreen sessions", async () => {
		const threads = Array.from({ length: 500 }, (_, index) => ({
			remoteId: `ses-${index}`,
			title: `Session ${index}`,
		}));
		const { navigate, screen } = renderSessionList({ threads });

		await expect.element(screen.getByText("Session 499")).toBeVisible();
		await expect.element(screen.getByText("Session 0")).not.toBeInTheDocument();

		const inbox = screen.getByTestId("session-list-inbox").element();
		act(() => {
			inbox.scrollTop = inbox.scrollHeight;
			inbox.dispatchEvent(new Event("scroll"));
		});

		await expect.element(screen.getByText("Session 0")).toBeVisible();
		await expect.element(screen.getByText("Session 499")).not.toBeInTheDocument();
		await screen.getByText("Session 0").click();
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("keeps keyboard navigation working across virtualized ranges", async () => {
		const threads = Array.from({ length: 40 }, (_, index) => ({
			remoteId: `ses-${index}`,
			title: `Session ${index}`,
		}));
		const { screen } = renderSessionList({ threads });

		const firstSession = screen.getByRole("button", { name: "Session 39" });
		await expect.element(firstSession).toBeVisible();
		firstSession.element().focus();
		for (let index = 0; index < 25; index += 1) {
			await userEvent.keyboard("{ArrowDown}");
		}

		await expect.element(screen.getByRole("button", { name: "Session 14" })).toHaveFocus();
	});

	it("keeps view controls visible when regrouping and reordering a large history", async () => {
		const threads = Array.from({ length: 500 }, (_, index) => ({
			remoteId: `ses-${index}`,
			title: `Session ${index.toString().padStart(3, "0")}`,
		}));
		const { screen } = renderSessionList({ threads });
		const inbox = screen.getByTestId("session-list-inbox");

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Updated" }).click();

		await expect
			.element(screen.getByRole("button", { name: "Session list options" }))
			.toBeVisible();
		expect(inbox.element().scrollTop).toBe(0);
		await expect.element(screen.getByRole("button", { name: "Older" })).toBeVisible();
		await expect.element(page.getByRole("menuitem", { name: /Grouping/ })).toBeVisible();
		await userEvent.keyboard("{Escape}{Escape}");

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Ordering/ }).click();
		await page.getByRole("menuitemradio", { name: "Title" }).click();

		await expect
			.element(screen.getByRole("button", { name: "Session list options" }))
			.toBeVisible();
		expect(inbox.element().scrollTop).toBe(0);
		await expect.element(screen.getByRole("button", { name: "Older" })).toBeVisible();
		await expect.element(page.getByRole("menuitem", { name: /Ordering/ })).toBeVisible();
	});

	it("keeps composer input working with a virtualized session history", async () => {
		const threads = Array.from({ length: 500 }, (_, index) => ({
			remoteId: `ses-${index}`,
			title: `Session ${index}`,
		}));
		const { screen } = renderSessionList({ threads, includeComposer: true });

		await expect.element(screen.getByText("Session 499")).toBeVisible();
		await expect.element(screen.getByText("Session 0")).not.toBeInTheDocument();
		const composer = screen.getByRole("textbox", { name: "Test composer" });
		const element = composer.element() as HTMLTextAreaElement;
		const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		if (!setValue) throw new Error("HTMLTextAreaElement.value setter is unavailable");
		Array.from({ length: 10 }, (_, index) => {
			const character = String.fromCharCode(97 + index);
			const value = element.value + character;
			setValue.call(element, value);
			element.dispatchEvent(
				new InputEvent("input", { bubbles: true, data: character, inputType: "insertText" }),
			);
		});

		await expect.element(composer).toHaveValue("abcdefghij");
		await expect.element(screen.getByText("Session 0")).not.toBeInTheDocument();
	});

	it("creates a chat from the New session entry", async () => {
		const { baseElement, navigate, screen } = renderSessionList({ threads: [] });

		await expect.element(page.getByTestId("kilo-thread-list")).toBeVisible();
		const trigger = screen.getByRole("button", { name: "New session" });
		await expect.element(trigger).toBeVisible();
		expect(baseElement.querySelector('[data-slot="aui_thread-list-new"]')).not.toBeNull();
		expect(baseElement.querySelector('[data-slot="aui_thread-list-items"]')?.className).toContain(
			"scroll-fade",
		);

		await trigger.click();
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenLastCalledWith("/plugins/chat", undefined);
	});

	it("opens a command dialog from Search and jumps to a matching chat", async () => {
		const { navigate, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();

		await screen.getByRole("button", { name: "Search" }).click();
		const dialog = page.getByRole("dialog");
		await expect.element(dialog).toBeVisible();
		expect(Number.parseFloat(getComputedStyle(dialog.element()).top)).toBeCloseTo(
			window.innerHeight / 2,
			0,
		);
		const list = dialog.element().querySelector("[data-slot='command-list']");
		expect(list).toBeTruthy();
		expect(getComputedStyle(list as Element).scrollbarWidth).not.toBe("none");
		const chat = page.getByRole("option", { name: /Fix the bug/ });
		await expect.element(chat).toBeVisible();
		expect(chat.element().textContent).toContain("Acme App");
		expect(chat.element().getBoundingClientRect().height).toBeLessThan(56);
		await expect.element(page.getByRole("option", { name: /Add tests/ })).toBeVisible();

		await page.getByRole("combobox", { name: "Search sessions and workspaces" }).fill("Add tests");
		await expect.element(page.getByRole("option", { name: /Add tests/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByRole("option", { name: /Add tests/ }).click();
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("preserves archived state when opening a chat from search", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Archived chat", status: "archived" }],
		});

		await screen.getByRole("button", { name: "Search" }).click();
		await page.getByRole("option", { name: /Archived chat/ }).click();

		await screen.getByTestId("session-list-archived-toggle").click();
		const row = screen.getByRole("listitem").filter({ hasText: "Archived chat" });
		await vi.waitFor(() =>
			expect(
				row.element().querySelector('[data-slot="aui_session-list-archived-item"]')?.className,
			).toContain("bg-state-selected"),
		);
		expect(adapter.unarchiveCalls).toEqual([]);
	});

	it("lists workspaces in search and switches to a matching workspace", async () => {
		const { screen, setActiveWorkspaceId } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await screen.getByRole("button", { name: "Search" }).click();
		const dialog = page.getByRole("dialog");
		await expect.element(dialog).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).toBeVisible();
		const workspace = page.getByTestId("session-search-workspace-ws-1");
		await expect.element(workspace).toBeVisible();
		expect(workspace.element().textContent).toContain("acme");
		expect(workspace.element().getBoundingClientRect().height).toBeLessThan(48);
		await expect.element(page.getByTestId("session-search-workspace-ws-2")).toBeVisible();

		await page.getByRole("combobox", { name: "Search sessions and workspaces" }).fill("Beta");
		await expect.element(page.getByTestId("session-search-workspace-ws-2")).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).not.toBeInTheDocument();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByTestId("session-search-workspace-ws-2").click();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-2");
		await expect.element(screen.getByText("No sessions in Beta")).toBeVisible();
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("does not mark the active workspace in search", async () => {
		const { screen } = renderSessionList({
			threads: [],
			activeWorkspaceId: "ws-1",
		});

		await screen.getByRole("button", { name: "Search" }).click();
		const workspace = page.getByTestId("session-search-workspace-ws-1");
		await expect.element(workspace).toBeVisible();
		await expect
			.element(workspace.getByTestId("session-search-workspace-active"))
			.not.toBeInTheDocument();
		expect(workspace.element().textContent).not.toContain("Active workspace");
	});

	it("filters search results with All, Sessions, and Workspaces chips", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await screen.getByRole("button", { name: "Search" }).click();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).toBeVisible();
		const all = page.getByRole("button", { name: "All" });
		const sessions = page.getByRole("button", { name: "Sessions" });
		expect(all.element().getAttribute("aria-pressed")).toBe("true");
		expect(sessions.element().getAttribute("aria-pressed")).toBe("false");
		expect(all.element().className).not.toContain("border-input");
		expect(all.element().className).toContain("hover:bg-muted");
		expect(all.element().className).toContain("aria-pressed:bg-muted");

		await page.getByRole("button", { name: "Workspaces" }).click();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-2")).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByRole("button", { name: "Sessions" }).click();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).not.toBeInTheDocument();

		await page.getByRole("button", { name: "All" }).click();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).toBeVisible();
	});

	it("keeps hover actions from covering the session title", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Unicorn and dodo population study" }],
		});

		const card = screen.getByRole("listitem").filter({
			hasText: "Unicorn and dodo population study",
		});
		await userEvent.hover(card);
		const archive = card.getByRole("button", { name: "Archive thread" });
		await expect.element(archive).toBeVisible();

		const title = card.element().querySelector('[data-slot="aui_session-list-item-title"]');
		expect(title).not.toBeNull();
		const titleBox = title!.getBoundingClientRect();
		const archiveBox = archive.element().getBoundingClientRect();
		expect(titleBox.right).toBeLessThanOrEqual(archiveBox.left);
	});

	it("renders session cards and the archived shelf", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
				{ remoteId: "ses-3", title: "Old work", status: "archived" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
				store.getState().hydrateSessions([{ id: "ses-3", updatedAt: Date.now() - 120_000 }]);
			},
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		const sessionTitle = screen
			.getByRole("listitem")
			.filter({ hasText: "Fix the bug" })
			.element()
			.querySelector('[data-slot="aui_session-list-item-title"]');
		expect(sessionTitle?.className).toContain("text-sm");
		const groupingHeader = screen.getByTestId("session-list-grouping-header");
		await expect
			.element(groupingHeader.getByRole("combobox", { name: "Filter by workspace" }))
			.toBeVisible();
		await expect
			.element(groupingHeader.getByRole("combobox", { name: "Filter by workspace" }))
			.toHaveTextContent("All workspaces");
		await expect.element(screen.getByTestId("session-list-inbox-header")).not.toBeInTheDocument();
		await expect
			.element(groupingHeader.getByRole("heading", { name: "Status" }))
			.not.toBeInTheDocument();
		await expect
			.element(groupingHeader.getByRole("button", { name: "Session list options" }))
			.toBeVisible();
		await expect.element(screen.getByTestId("session-list-active-toggle")).toBeVisible();
		const activeRow = screen.getByTestId("session-list-active-toggle").element().closest("li");
		expect(activeRow).not.toBeNull();
		expect(activeRow!.querySelector('[data-qa-id="session-list-view-menu"]')).toBeNull();
		await expect
			.element(screen.getByRole("button", { name: "Session list options" }))
			.toBeVisible();
		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		const activeHeader = screen.getByTestId("session-list-active-toggle").element();
		const activeLabel = screen
			.getByTestId("session-list-active-toggle")
			.getByText("Active")
			.element();
		expect(activeLabel.className).toContain("text-sm");
		expect(activeLabel.className).toContain("font-normal");
		expect(activeLabel.className.split(/\s+/)).toContain("text-muted-foreground");
		const archivedLabel = screen
			.getByTestId("session-list-archived-toggle")
			.getByText("Archived")
			.element();
		expect(archivedLabel.className.split(/\s+/)).toContain("text-muted-foreground");
		expect(activeHeader.className).toContain("hover:bg-transparent");
		expect(activeHeader.className).toContain("aria-expanded:bg-transparent");
		expect(getComputedStyle(activeHeader).backgroundColor).toMatch(
			/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/,
		);
		const chevron = activeHeader.querySelector("svg");
		expect(chevron).not.toBeNull();
		expect(getComputedStyle(chevron!).opacity).toBe("0");
		await userEvent.hover(screen.getByTestId("session-list-active-toggle"));
		await expect.poll(() => getComputedStyle(chevron!).opacity).toBe("1");
		await expect
			.element(screen.getByTestId("session-list-archived-toggle"))
			.toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();
		await screen.getByTestId("session-list-archived-toggle").click();
		await expect.element(screen.getByText("Old work")).toBeVisible();
		const archivedShelfRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await expect.element(archivedShelfRow.getByText("2m")).not.toBeInTheDocument();
		// Workspace is opt-in via Show — default rows are title-only.
		await expect.element(screen.getByText("Acme App")).not.toBeInTheDocument();
		await expect.element(screen.getByText("PR #42").first()).toBeVisible();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Updated" }).click();
		await expect.element(archivedShelfRow.getByText("2m")).toBeVisible();
	});

	it("restores the Archived shelf expansion preference", async () => {
		const threads: SeededThread[] = [
			{ remoteId: "ses-1", title: "Active work" },
			{ remoteId: "ses-2", title: "Old work", status: "archived" },
		];
		const first = renderSessionList({ threads });

		await expect.element(first.screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		await expect.element(first.screen.getByText("Old work")).not.toBeInTheDocument();
		await first.screen.getByTestId("session-list-archived-toggle").click();
		await expect.element(first.screen.getByText("Old work")).toBeVisible();
		first.unmount();

		const second = renderSessionList({ threads });
		await expect.element(second.screen.getByText("Old work")).toBeVisible();
		await second.screen.getByTestId("session-list-archived-toggle").click();
		await expect.element(second.screen.getByText("Old work")).not.toBeInTheDocument();
		second.unmount();

		const third = renderSessionList({ threads });
		await expect.element(third.screen.getByText("Old work")).not.toBeInTheDocument();
	});

	it("keeps the Archived shelf collapsed after Collapse All in another grouping", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", workspaceId: "ws-1" },
					{ id: "ses-2", workspaceId: "ws-1" },
				]);
			},
		});

		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await expect
			.element(screen.getByTestId("session-list-workspace-toggle").filter({ hasText: "Acme App" }))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-archived-toggle"))
			.toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();

		await page.getByRole("menuitem", { name: "Collapse All" }).click();
		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Status" }).click();

		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-archived-toggle"))
			.toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();
	});

	it("opens the session list options menu to the right of the button", async () => {
		const { screen } = renderSessionList({ threads: [] });

		const button = screen.getByRole("button", { name: "Session list options" });
		await button.click();
		const menu = page.getByRole("menu");
		await expect.element(menu).toBeVisible();
		expect(menu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
			button.element().getBoundingClientRect().right,
		);
	});

	it("keeps the selected session title as bright as hover", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
		});

		const selected = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		const idle = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		// No hover on the idle row: the assertions read hover *variant* classes,
		// and the selected row's 600ms details card can open over the idle row
		// on a slow runner, blocking a hover indefinitely.
		await selected.getByRole("button", { name: /Add tests/ }).click();
		await expect
			.poll(
				() => selected.element().querySelector('[data-slot="aui_session-list-item"]')?.className,
			)
			.toContain("bg-state-selected");

		const selectedTitle = selected
			.element()
			.querySelector('[data-slot="aui_session-list-item-title"]');
		const idleTitle = idle.element().querySelector('[data-slot="aui_session-list-item-title"]');
		const selectedClasses = selectedTitle?.className.split(/\s+/) ?? [];
		const idleClasses = idleTitle?.className.split(/\s+/) ?? [];
		expect(selectedClasses).toContain("text-sidebar-foreground");
		expect(selectedClasses).not.toContain("text-sidebar-foreground/85");
		expect(selectedClasses).not.toContain("text-sidebar-accent-foreground");
		expect(idleClasses).toContain("group-hover/sidebar-row:text-sidebar-foreground");
		expect(idleClasses).not.toContain("group-hover/sidebar-row:text-sidebar-accent-foreground");
		const selectedRow = selected.element().querySelector('[data-slot="aui_session-list-item"]');
		const idleRow = idle.element().querySelector('[data-slot="aui_session-list-item"]');
		const selectedRowClasses = selectedRow?.className.split(/\s+/) ?? [];
		const idleRowClasses = idleRow?.className.split(/\s+/) ?? [];
		expect(selectedRowClasses).toContain("bg-state-selected");
		expect(selectedRowClasses).not.toContain("bg-muted");
		expect(idleRowClasses).not.toContain("bg-state-selected");
	});

	it("uses a single-row card without a location for unscoped sessions", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-workspace", title: "Workspace greeting" },
				{ remoteId: "ses-unscoped", title: "Unscoped greeting" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-workspace", workspaceId: "ws-1", directory: "/repo/acme" },
					{ id: "ses-unscoped", directory: "/chats/session-uSrBjH" },
				]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Workspace" }).click();

		const workspaceCard = screen.getByRole("listitem").filter({ hasText: "Workspace greeting" });
		const unscopedCard = screen.getByRole("listitem").filter({ hasText: "Unscoped greeting" });

		await expect.element(workspaceCard.getByText("Acme App")).toBeVisible();
		await expect.element(unscopedCard.getByText("Unscoped greeting")).toBeVisible();
		await expect.element(unscopedCard.getByText("session-uSrBjH")).not.toBeInTheDocument();
		await expect.element(unscopedCard.getByText("Acme App")).not.toBeInTheDocument();
	});

	it("surfaces sessions needing attention at the top", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) =>
				store.getState().applyEvent({
					type: "permission.asked",
					properties: { id: "perm-1", sessionID: "ses-2" },
				}),
		});

		await expect.element(screen.getByTestId("session-list-attention-toggle")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: /^Needs attention$/ })).toBeVisible();
		await expect.element(screen.getByRole("status", { name: "Requires approval" })).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
	});

	it("moves a card to Needs Attention when a permission arrives live", async () => {
		const { screen, store } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-attention-toggle"))
			.not.toBeInTheDocument();

		act(() => {
			store.getState().applyEvent({
				type: "question.asked",
				properties: { id: "q-1", sessionID: "ses-1" },
			});
		});

		await expect.element(screen.getByTestId("session-list-attention-toggle")).toBeVisible();
		await expect.element(screen.getByRole("status", { name: "Requires input" })).toBeVisible();
	});

	it("archives a quiet session", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(card).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-archived-toggle"))
			.not.toBeInTheDocument();

		await userEvent.hover(card);
		await card.getByRole("button", { name: "Archive thread" }).click();

		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		expect(adapter.archiveCalls).toEqual(["ses-1"]);

		await screen.getByTestId("session-list-archived-toggle").click();
		await expect
			.element(screen.getByRole("listitem").filter({ hasText: "Fix the bug" }))
			.toBeVisible();
	});

	// The Kilo server cannot clear an archive timestamp, so an unarchive
	// would silently revert on the next launch.
	it("does not offer unarchive for archived sessions", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Old work", status: "archived" }],
		});

		await screen.getByTestId("session-list-archived-toggle").click();
		const card = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await userEvent.hover(card);

		await expect
			.element(card.getByRole("button", { name: "Unarchive thread" }))
			.not.toBeInTheDocument();
		await card.getByRole("button", { name: "Thread actions" }).click();
		await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
		await expect.element(page.getByRole("menuitem", { name: "Unarchive" })).not.toBeInTheDocument();
	});

	it("keeps an archived session archived when viewing it", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		await screen.getByTestId("session-list-archived-toggle").click();
		const archivedRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await expect.element(archivedRow).toBeVisible();

		await archivedRow.getByRole("button", { name: /Old work/ }).click();

		expect(adapter.unarchiveCalls).toEqual([]);
		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		await expect
			.element(screen.getByRole("listitem").filter({ hasText: "Old work" }))
			.toBeVisible();
	});

	it("keeps an archived session that needs attention archived when opening it", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Old work", status: "archived" }],
			hydrate: (store) =>
				store.getState().applyEvent({
					type: "permission.asked",
					properties: { id: "perm-1", sessionID: "ses-1" },
				}),
		});

		await screen.getByTestId("session-list-archived-toggle").click();
		await expect.element(screen.getByRole("status", { name: "Requires approval" })).toBeVisible();
		await screen.getByRole("button", { name: /Old work/ }).click();

		await vi.waitFor(() =>
			expect(
				screen
					.getByRole("listitem")
					.filter({ hasText: "Old work" })
					.element()
					.querySelector('[data-slot="aui_session-list-item"]')?.className,
			).toContain("bg-state-selected"),
		);
		expect(adapter.unarchiveCalls).toEqual([]);
		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
	});

	it("keeps grouped session titles aligned and inset when a status icon is present", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) =>
				store.getState().applyEvent({
					type: "session.status",
					properties: { sessionID: "ses-1", status: { type: "busy" } },
				}),
		});

		const working = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const idle = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		const icon = working.getByRole("status", { name: "Working" });
		await expect.element(icon).toBeVisible();

		const workingTitle = working
			.element()
			.querySelector('[data-slot="aui_session-list-item-title"]');
		const idleTitle = idle.element().querySelector('[data-slot="aui_session-list-item-title"]');
		expect(workingTitle).not.toBeNull();
		expect(idleTitle).not.toBeNull();
		const workingLeft = workingTitle!.getBoundingClientRect().left;
		const idleLeft = idleTitle!.getBoundingClientRect().left;
		expect(Math.abs(workingLeft - idleLeft)).toBeLessThan(2);

		const headerLabel = screen.getByTestId("session-list-active-toggle").getByText("Active");
		const iconBox = icon.element().getBoundingClientRect();
		const headerLeft = headerLabel.element().getBoundingClientRect().left;
		expect(iconBox.left - headerLeft).toBeCloseTo(1, 0);
		expect(iconBox.right).toBeLessThanOrEqual(workingLeft + 1);

		const root = working.element().querySelector('[data-slot="aui_session-list-item"]');
		expect(root).not.toBeNull();
		const rootBox = root!.getBoundingClientRect();
		expect(iconBox.left).toBeGreaterThanOrEqual(rootBox.left);
		expect(iconBox.right).toBeLessThanOrEqual(rootBox.right);
	});

	it("shows working duration in a tooltip on the status icon", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) =>
				store.getState().applyEvent({
					type: "session.status",
					properties: { sessionID: "ses-1", status: { type: "busy" } },
				}),
		});

		const icon = screen.getByRole("status", { name: "Working" });
		await expect.element(icon).toBeVisible();
		await icon.hover();

		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toMatch(/^Working · \d+s$/);
	});

	it("does not show a leading icon on idle chats", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Unscoped chat" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		const scoped = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const unscoped = screen.getByRole("listitem").filter({ hasText: "Unscoped chat" });
		await expect.element(scoped.getByTestId("session-list-idle-dot")).not.toBeInTheDocument();
		await expect.element(scoped.getByTestId("session-list-workspace-dot")).not.toBeInTheDocument();
		await expect.element(unscoped.getByTestId("session-list-idle-dot")).not.toBeInTheDocument();
		await expect
			.element(unscoped.getByTestId("session-list-workspace-dot"))
			.not.toBeInTheDocument();
		await expect.element(scoped.getByRole("status")).not.toBeInTheDocument();
		await expect.element(unscoped.getByRole("status")).not.toBeInTheDocument();
	});

	it("shows a muted status dot on done chats", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
				store.getState().markVisited("ses-1", Date.now() - 10_000);
				store.getState().applyEvent({
					type: "session.status",
					properties: { sessionID: "ses-1", status: { type: "busy" } },
				});
				store.getState().applyEvent({
					type: "session.status",
					properties: { sessionID: "ses-1", status: { type: "idle" } },
				});
			},
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const status = card.getByRole("status", { name: "Unread" });
		const dot = card.getByTestId("session-list-done-dot");
		await expect.element(status).toBeVisible();
		await expect.element(dot).toBeVisible();
		expect(status.element().querySelector("svg")).toBeNull();
		expect(dot.element().className).toContain("bg-primary");
		expect(dot.element().style.backgroundColor).toBe("");
	});

	it("hides the archive action while a session is working", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) =>
				store.getState().applyEvent({
					type: "session.status",
					properties: { sessionID: "ses-1", status: { type: "busy" } },
				}),
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(card).toBeVisible();
		await expect.element(screen.getByRole("status", { name: "Working" })).toBeVisible();

		await userEvent.hover(card);
		await expect
			.element(card.getByRole("button", { name: "Archive thread" }))
			.not.toBeInTheDocument();
		await expect.element(card.getByRole("button", { name: "Thread actions" })).toBeVisible();
	});

	it("renames a session from the row menu", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(card).toBeVisible();
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();

		await page.getByRole("menuitem", { name: "Rename" }).click();
		const input = screen.getByRole("textbox", { name: "Rename thread" });
		await expect.element(input).toBeVisible();
		await userEvent.clear(input);
		await userEvent.type(input, "Renamed session{Enter}");

		await expect.element(screen.getByText("Renamed session")).toBeVisible();
		expect(adapter.renameCalls).toEqual([{ remoteId: "ses-1", title: "Renamed session" }]);
	});

	it("deletes a session without crashing during the exit animation", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Keep me" },
				{ remoteId: "ses-2", title: "Delete me" },
			],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Delete me" });
		await expect.element(card).toBeVisible();
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await expect
			.element(page.getByRole("alertdialog", { name: "Delete this session?" }))
			.toBeVisible();
		await expect
			.element(page.getByTestId("session-delete-chat-preview"))
			.toHaveTextContent("Delete me");
		expect(adapter.deleteCalls).toEqual([]);
		await confirmChatDelete();

		await expect.element(screen.getByText("Delete me")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Keep me")).toBeVisible();
		expect(adapter.deleteCalls).toEqual(["ses-2"]);
	});

	it("keeps the chat when the delete confirmation is cancelled", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Keep me" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Keep me" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByTestId("session-delete-cancel").click();

		await expect.element(page.getByTestId("session-delete-dialog")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Keep me")).toBeVisible();
		expect(adapter.deleteCalls).toEqual([]);
	});

	it("does not offer Status in the Show menu", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();

		await expect.element(page.getByRole("menuitemcheckbox", { name: "Workspace" })).toBeVisible();
		await expect.element(page.getByRole("menuitemcheckbox", { name: "Updated" })).toBeVisible();
		await expect
			.element(page.getByRole("menuitemcheckbox", { name: "Status" }))
			.not.toBeInTheDocument();
	});

	it("adds a workspace info line when Show is enabled", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Acme App")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Workspace" }).click();

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const info = card.getByText("Acme App");
		await expect.element(info).toBeVisible();
		const icon = card.element().querySelector('[data-slot="aui_session-list-workspace-icon"]');
		expect(icon?.getAttribute("stroke")).toBe("#F87171");
		expect(info.element().previousElementSibling).toBe(icon);
		expect(info.element().getBoundingClientRect().height).toBeGreaterThan(8);
		expect(card.element().getBoundingClientRect().height).toBeGreaterThan(36);
	});

	it.each([
		["the default view", {}],
		["workspace grouping", { grouping: "workspace", show: ["workspace", "pr"] }],
	] as const)("keeps the PR beside the title in %s", async (_, view) => {
		storeView(view);
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(card.getByText("PR #42")).toBeVisible();
		expect(rowSlot(card, "time")).toHaveTextContent("PR #42");
		expect(rowSlot(card, "info")).toBeNull();
	});

	it("keeps row metadata inert, since the whole row opens the chat", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		const badge = screen
			.getByRole("listitem")
			.filter({ hasText: "Fix the bug" })
			.getByText("PR #42");
		await expect.element(badge).toBeVisible();
		await expect.element(badge).not.toHaveAttribute("data-interactive");
	});

	it("drops the time before squeezing the title when a PR shares a narrow row", async () => {
		storeView({ show: ["updated", "pr"] });
		const { screen } = renderSessionList({
			width: 208,
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Unscoped question" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		const withPr = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const withoutPr = screen.getByRole("listitem").filter({ hasText: "Unscoped question" });
		await expect.element(withPr.getByText("PR #42")).toBeVisible();
		expect(getComputedStyle(rowSlot(withPr, "updated")!).display).toBe("none");
		expect(getComputedStyle(rowSlot(withoutPr, "updated")!).display).not.toBe("none");
	});

	it("shows workspace info only while viewing all workspaces", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", workspaceId: "ws-1" },
					{ id: "ses-2", workspaceId: "ws-2" },
				]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Workspace" }).click();
		await expect.element(screen.getByText("Acme App")).toBeVisible();
		await expect.element(screen.getByText("Beta")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		const workspaceFilter = screen.getByRole("combobox", { name: "Filter by workspace" });
		await workspaceFilter.click();
		await page.getByRole("option", { name: /Acme App/ }).click();
		const focusedCard = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(focusedCard).toBeVisible();
		await expect.element(focusedCard.getByText("Acme App")).not.toBeInTheDocument();
		expect(
			focusedCard.element().querySelector('[data-slot="aui_session-list-workspace-icon"]'),
		).toBeNull();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await expect
			.element(page.getByRole("menuitemcheckbox", { name: "Workspace" }))
			.toHaveAttribute("data-checked");
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		await workspaceFilter.click();
		await page.getByRole("option", { name: "All workspaces" }).click();
		const acmeCard = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const betaCard = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		await expect.element(acmeCard.getByText("Acme App")).toBeVisible();
		await expect.element(betaCard.getByText("Beta")).toBeVisible();
	});

	it("groups sessions by updated time into calendar buckets", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", updatedAt: Date.now() },
					{ id: "ses-2", updatedAt: Date.now() - 3 * 86_400_000 },
				]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await expect.element(screen.getByTestId("session-list-workspace-toggle").first()).toBeVisible();
		await expect.element(screen.getByTestId("session-list-active-toggle")).not.toBeInTheDocument();
		await expect.element(page.getByRole("menuitemradio", { name: "Updated" })).toBeVisible();
		await page.getByRole("menuitemradio", { name: "Updated" }).click();
		await expect.element(screen.getByRole("button", { name: "Today" })).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-workspace-toggle").first())
			.not.toBeInTheDocument();
		await expect.element(page.getByRole("menuitemradio", { name: "Workspace" })).toBeVisible();

		await expect.element(screen.getByRole("button", { name: "Today" })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Last 7 Days" })).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("3d")).not.toBeInTheDocument();
	});

	it("groups sessions by workspace without a Needs Attention section", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", workspaceId: "ws-1" },
					{ id: "ses-2", workspaceId: "ws-1" },
				]);
				store.getState().applyEvent({
					type: "permission.asked",
					properties: { id: "perm-1", sessionID: "ses-2" },
				});
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();

		const groupingHeader = screen.getByTestId("session-list-grouping-header");
		await expect
			.element(groupingHeader.getByRole("combobox", { name: "Filter by workspace" }))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-attention-toggle"))
			.not.toBeInTheDocument();
		const workspaceToggle = screen
			.getByTestId("session-list-workspace-toggle")
			.filter({ hasText: "Acme App" });
		await expect.element(workspaceToggle).toBeVisible();
		expect(
			workspaceToggle.element().querySelector('[data-qa-id="session-list-view-menu"]'),
		).toBeNull();
		const workspaceIcon = workspaceToggle
			.element()
			.querySelector('[data-slot="aui_session-list-workspace-icon"]');
		expect(workspaceIcon?.getAttribute("stroke")).toBe("#F87171");
		await expect.element(screen.getByText("Acme App")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
	});

	it("creates a new chat in a workspace from its group header", async () => {
		const { navigate, screen, setActiveWorkspaceId } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", workspaceId: "ws-1" },
					{ id: "ses-2", workspaceId: "ws-2" },
				]);
			},
		});

		await expect
			.element(screen.getByRole("button", { name: "New session in Acme App" }))
			.not.toBeInTheDocument();
		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		const createChat = screen.getByRole("button", { name: "New session in Acme App" });
		const controls = screen.getByTestId("session-list-workspace-controls-ws-1");
		await expect.element(createChat).toBeVisible();
		expect(createChat.element().querySelector("svg")?.classList.contains("lucide-plus")).toBe(true);
		await screen.getByTestId("session-list-grouping-header").hover();
		await expect.poll(() => getComputedStyle(controls.element()).opacity).toBe("0");
		const workspaceRow = screen.getByRole("button", { name: "Acme App" });
		await workspaceRow.hover();
		await expect.poll(() => getComputedStyle(controls.element()).opacity).toBe("1");
		await createChat.hover();
		await expect.element(page.getByText("New session", { exact: true })).toBeVisible();
		await workspaceRow.click();
		await expect.element(workspaceRow).toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		await workspaceRow.click();
		await expect.element(workspaceRow).toHaveAttribute("aria-expanded", "true");
		await createChat.click();

		expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-1");
		expect(navigate).toHaveBeenLastCalledWith("/plugins/chat", undefined);
	});

	it("lists a workspace with no chats with an empty-state note", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		await expect.element(screen.getByRole("button", { name: "Beta" })).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-workspace-empty-ws-1"))
			.not.toBeInTheDocument();
		const emptyNote = screen.getByTestId("session-list-workspace-empty-ws-2");
		await expect.element(emptyNote).toHaveTextContent("No sessions yet");

		await screen.getByRole("button", { name: "Beta" }).click();
		await expect.element(emptyNote).not.toBeInTheDocument();
	});

	it("keeps a workspace group after its only chat is archived", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Archive thread" }).click();

		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
		expect(adapter.archiveCalls).toEqual(["ses-1"]);
		await expect.element(screen.getByRole("button", { name: "Acme App" })).toBeVisible();
		await expect.element(screen.getByTestId("session-list-workspace-empty-ws-1")).toBeVisible();
	});

	it("opens the Archived shelf while filtering by Archived and restores it afterwards", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		const archivedToggle = screen.getByTestId("session-list-archived-toggle");
		await expect.element(archivedToggle).toHaveAttribute("aria-expanded", "false");

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /^Status/ }).click();
		await page.getByRole("menuitemradio", { name: "Archived" }).click();

		await expect.element(archivedToggle).toHaveAttribute("aria-expanded", "true");
		await expect
			.element(screen.getByRole("listitem").filter({ hasText: "Old work" }))
			.toBeVisible();

		await page.getByRole("menuitemradio", { name: "All" }).click();

		await expect.element(archivedToggle).toHaveAttribute("aria-expanded", "false");
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();
	});

	it("says no chats match when a status filter hides a workspace's chats", async () => {
		localStorage.setItem(
			SESSION_LIST_VIEW_STORAGE_KEY,
			JSON.stringify({ grouping: "workspace", status: "working" }),
		);
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-2" }]);
			},
		});

		await expect.element(screen.getByRole("button", { name: "Beta" })).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("session-list-workspace-empty-ws-2"))
			.toHaveTextContent('No sessions matching "Working"');
	});

	describe("pull request filter", () => {
		const prThreads: SeededThread[] = [
			{ remoteId: "ses-open", title: "Open PR work" },
			{ remoteId: "ses-merged", title: "Merged PR work" },
			{ remoteId: "ses-none", title: "No PR work" },
		];
		const hydratePrSessions = (store: ReturnType<typeof createSessionActivityStore>) => {
			store.getState().hydrateSessions([
				{ id: "ses-open", workspaceId: "ws-1", worktreeBranch: "kilo/open" },
				{ id: "ses-merged", workspaceId: "ws-1", worktreeBranch: "kilo/merged" },
				{ id: "ses-none", workspaceId: "ws-1", worktreeBranch: "kilo/none" },
			]);
		};
		const pullRequests: GitPullRequestStatusStoreValue = {
			"ws-1:worktree:kilo/open": { state: "open" },
			"ws-1:worktree:kilo/merged": { state: "merged" },
		};

		async function pickPullRequestFilter(
			screen: ReturnType<typeof page.elementLocator>,
			label: string,
		) {
			await screen.getByRole("button", { name: "Session list options" }).click();
			await page.getByRole("menuitem", { name: /^Pull request/ }).click();
			await page.getByRole("menuitemradio", { name: label }).click();
		}

		it("is hidden without the git plugin's pull request status", async () => {
			storeView({ pullRequest: "open" });
			const { screen } = renderSessionList({ threads: prThreads, hydrate: hydratePrSessions });

			await expect.element(screen.getByText("No PR work")).toBeVisible();
			await screen.getByRole("button", { name: "Session list options" }).click();
			await expect.element(page.getByRole("menuitem", { name: /^Status/ })).toBeVisible();
			await expect
				.element(page.getByRole("menuitem", { name: /^Pull request/ }))
				.not.toBeInTheDocument();
		});

		it("shows only chats with a pull request, or only open ones", async () => {
			const { screen } = renderSessionList({
				threads: prThreads,
				hydrate: hydratePrSessions,
				pullRequests,
			});

			await pickPullRequestFilter(screen, "Any PR");
			await expect.element(screen.getByText("Open PR work")).toBeVisible();
			await expect.element(screen.getByText("Merged PR work")).toBeVisible();
			await expect.element(screen.getByText("No PR work")).not.toBeInTheDocument();

			await page.getByRole("menuitemradio", { name: "Open PR" }).click();
			await expect.element(screen.getByText("Open PR work")).toBeVisible();
			await expect.element(screen.getByText("Merged PR work")).not.toBeInTheDocument();
			expect(JSON.parse(localStorage.getItem(SESSION_LIST_VIEW_STORAGE_KEY) ?? "{}")).toMatchObject(
				{ pullRequest: "open" },
			);
		});

		it("updates as pull request status arrives", async () => {
			storeView({ pullRequest: "any" });
			const { screen, pullRequestStatus } = renderSessionList({
				threads: prThreads,
				hydrate: hydratePrSessions,
				pullRequests: {},
			});

			await expect.element(screen.getByText("No sessions with pull requests")).toBeVisible();

			act(() => pullRequestStatus?.set(pullRequests));

			await expect.element(screen.getByText("Open PR work")).toBeVisible();
			await expect.element(screen.getByText("No PR work")).not.toBeInTheDocument();
		});

		it("clears with Reset view", async () => {
			storeView({ pullRequest: "open" });
			const { screen } = renderSessionList({
				threads: prThreads,
				hydrate: hydratePrSessions,
				pullRequests,
			});

			await expect.element(screen.getByText("No PR work")).not.toBeInTheDocument();
			await screen.getByRole("button", { name: "Session list options" }).click();
			await page.getByRole("menuitem", { name: "Reset view" }).click();

			await expect.element(screen.getByText("No PR work")).toBeVisible();
			await expect.element(screen.getByText("Merged PR work")).toBeVisible();
		});
	});

	it("shows empty workspace headers without the empty-state note while older chats load", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
			hasMorePages: true,
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		await expect.element(screen.getByRole("button", { name: "Beta" })).toBeVisible();
		await expect
			.element(screen.getByTestId("session-list-workspace-empty-ws-2"))
			.not.toBeInTheDocument();
	});

	it("opens the workspace Edit and Delete actions from its group header", async () => {
		const { openDelete, openEdit, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		const workspaceToggle = screen.getByRole("button", { name: "Acme App" });
		const actions = screen.getByRole("button", { name: "Workspace actions for Acme App" });
		const controls = screen.getByTestId("session-list-workspace-controls-ws-1");
		await screen.getByTestId("session-list-grouping-header").hover();
		await expect.poll(() => getComputedStyle(controls.element()).opacity).toBe("0");
		await workspaceToggle.hover();
		await expect.poll(() => getComputedStyle(controls.element()).opacity).toBe("1");

		await actions.click();
		await page.getByRole("menuitem", { name: "Edit" }).click();
		expect(openEdit).toHaveBeenCalledWith(workspacesValue.workspaces[0]);
		await expect.element(workspaceToggle).toHaveAttribute("aria-expanded", "true");

		await actions.click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
		expect(openDelete).toHaveBeenCalledWith(workspacesValue.workspaces[0]);
		await expect.element(workspaceToggle).toHaveAttribute("aria-expanded", "true");
	});

	it("keeps grouping values next to their submenu chevrons", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await screen.getByRole("button", { name: "Session list options" }).click();
		const grouping = page.getByRole("menuitem", { name: /Grouping/ });
		await expect.element(grouping).toBeVisible();

		const label = grouping.getByText("Grouping", { exact: true });
		const value = grouping.getByText("Status", { exact: true });
		const chevron = grouping.element().querySelector("svg");
		expect(chevron).not.toBeNull();
		const labelBox = label.element().getBoundingClientRect();
		const valueBox = value.element().getBoundingClientRect();
		const chevronBox = chevron!.getBoundingClientRect();
		expect(valueBox.left - labelBox.right).toBeGreaterThan(16);
		expect(chevronBox.left).toBeGreaterThanOrEqual(valueBox.right);
		expect(chevronBox.left - valueBox.right).toBeLessThan(12);
	});

	it("places the pin action next to the thread menu", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await userEvent.hover(card);
		const pin = card.getByRole("button", { name: "Pin thread" });
		const more = card.getByRole("button", { name: "Thread actions" });
		const archive = card.getByRole("button", { name: "Archive thread" });
		await expect.element(pin).toBeVisible();
		await expect.element(more).toBeVisible();
		await expect.element(archive).toBeVisible();

		const pinBox = pin.element().getBoundingClientRect();
		const moreBox = more.element().getBoundingClientRect();
		const archiveBox = archive.element().getBoundingClientRect();
		expect(pinBox.left).toBeGreaterThanOrEqual(archiveBox.right);
		expect(moreBox.left).toBeGreaterThanOrEqual(pinBox.right);
		expect(moreBox.left - pinBox.right).toBeLessThan(4);

		const archiveIcon = archive.element().querySelector("svg");
		const pinIcon = pin.element().querySelector("svg");
		expect(archiveIcon).not.toBeNull();
		expect(pinIcon).not.toBeNull();
		// Stock icon-xs buttons (24px) around 14px icons leave ~10px of padding.
		expect(
			pinIcon!.getBoundingClientRect().left - archiveIcon!.getBoundingClientRect().right,
		).toBeLessThan(14);
	});

	it("shows icon-only hover actions with tooltips", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await userEvent.hover(card);

		const archive = card.getByRole("button", { name: "Archive thread" });
		await expect.element(archive).toBeVisible();
		expect(archive.element().textContent?.trim()).toBe("");

		await archive.hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Archive");

		await card.getByRole("button", { name: "Pin thread" }).hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Pin");

		await card.getByRole("button", { name: "Thread actions" }).hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("More");
	});

	it("does not offer pin controls for archived sessions", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Old work", status: "archived" }],
		});

		await screen.getByTestId("session-list-archived-toggle").click();
		const card = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await userEvent.hover(card);

		await expect.element(card.getByRole("button", { name: "Pin thread" })).not.toBeInTheDocument();
		await card.getByRole("button", { name: "Thread actions" }).click();
		await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
		await expect.element(page.getByRole("menuitem", { name: /^Pin$/ })).not.toBeInTheDocument();
	});

	it("pins a session into Pinned and hides the section when empty", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
				{ remoteId: "ses-3", title: "Old work", status: "archived" },
			],
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByTestId("session-list-pinned-toggle")).not.toBeInTheDocument();

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Pin thread" }).click();

		await expect.element(screen.getByTestId("session-list-pinned-toggle")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: /^Pinned$/ })).toBeVisible();
		const pinnedLabel = screen
			.getByTestId("session-list-pinned-toggle")
			.getByText("Pinned")
			.element();
		expect(pinnedLabel.className).toContain("text-sm");
		const pinnedHeader = screen.getByTestId("session-list-pinned-toggle").element();
		const activeHeader = screen.getByTestId("session-list-active-toggle").element();
		expect(
			pinnedHeader.compareDocumentPosition(activeHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("Old work")).not.toBeInTheDocument();

		const pinnedCard = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const activeCard = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		const archivedHeader = screen.getByTestId("session-list-archived-toggle").element();
		await expect
			.poll(() => {
				const afterPinned =
					activeHeader.getBoundingClientRect().top -
					pinnedCard.element().getBoundingClientRect().bottom;
				const betweenSections =
					archivedHeader.getBoundingClientRect().top -
					activeCard.element().getBoundingClientRect().bottom;
				return Math.abs(afterPinned - betweenSections);
			})
			.toBeLessThan(3);

		await userEvent.hover(card);
		const unpin = card.getByRole("button", { name: "Unpin thread" });
		const more = card.getByRole("button", { name: "Thread actions" });
		await expect.element(unpin).toBeVisible();
		expect(unpin.element().querySelector("svg")?.classList.contains("lucide-pin-off")).toBe(true);
		const unpinBox = unpin.element().getBoundingClientRect();
		const moreBox = more.element().getBoundingClientRect();
		expect(moreBox.left).toBeGreaterThanOrEqual(unpinBox.right);
		expect(moreBox.left - unpinBox.right).toBeLessThan(8);

		await more.click();
		const unpinItem = page.getByRole("menuitem", { name: "Unpin" });
		await expect.element(unpinItem).toBeVisible();
		expect(unpinItem.element().querySelector("svg")?.classList.contains("lucide-pin-off")).toBe(
			true,
		);
		await userEvent.keyboard("{Escape}");

		await userEvent.hover(card);
		await card.getByRole("button", { name: "Unpin thread" }).click();
		await expect.element(screen.getByTestId("session-list-pinned-toggle")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
	});

	it("toggles a session pin on Shift+click without opening it", async () => {
		const { navigate, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
		});
		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const trigger = card.getByRole("button", { name: /Fix the bug/ });
		const row = () => card.element().querySelector('[data-slot="aui_session-list-item"]');

		await trigger.click({ modifiers: ["Shift"] });
		await expect.element(screen.getByTestId("session-list-pinned-toggle")).toBeVisible();

		await trigger.click({ modifiers: ["Shift"] });
		await expect.element(screen.getByTestId("session-list-pinned-toggle")).not.toBeInTheDocument();

		expect(navigate).not.toHaveBeenCalled();
		expect(row()?.classList.contains("bg-state-selected")).toBe(false);
	});

	it("opens an archived session on Shift+click without pinning or unarchiving it", async () => {
		const { adapter, navigate, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		await screen.getByTestId("session-list-archived-toggle").click();
		const archivedRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await archivedRow.getByRole("button", { name: /Old work/ }).click({ modifiers: ["Shift"] });

		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		expect(adapter.unarchiveCalls).toEqual([]);
		await expect.element(screen.getByTestId("session-list-pinned-toggle")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-archived-toggle")).toBeVisible();
	});

	it("filters the list to archived sessions", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /^Status/ }).click();
		await page.getByRole("menuitemradio", { name: "Archived" }).click();

		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");
		await expect.element(screen.getByText("Old work")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-active-toggle")).not.toBeInTheDocument();
	});

	it("shows New session above the session list", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const titlebarActions = screen.getByTestId("sidebar-header-actions");
		const groupingHeader = screen.getByTestId("session-list-grouping-header");
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByTestId("session-list-inbox-header")).not.toBeInTheDocument();
		const groupingHeaderEl = groupingHeader.element();
		const workspaceFilter = groupingHeader.getByRole("combobox", { name: "Filter by workspace" });
		await expect.element(workspaceFilter).toBeVisible();
		await expect.element(workspaceFilter).toHaveTextContent("All workspaces");
		const filter = screen.getByRole("button", { name: "Session list options" }).element();
		const newButton = screen.getByTestId("new-chat").element();
		const search = screen.getByRole("button", { name: "Search" }).element();
		const activeRow = screen.getByTestId("session-list-active-toggle").element().closest("li");
		const inbox = screen.getByTestId("session-list-inbox").element();
		expect(activeRow?.contains(filter)).toBe(false);
		expect(groupingHeaderEl.contains(filter)).toBe(true);
		expect(groupingHeaderEl.contains(workspaceFilter.element())).toBe(true);
		expect(
			workspaceFilter.element().compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(inbox.contains(filter)).toBe(false);
		expect(titlebarActions.element().contains(search)).toBe(false);
		expect(screen.getByTestId("kilo-thread-list").element().contains(search)).toBe(true);
		await expect.element(screen.getByTestId("session-list-chrome-divider")).not.toBeInTheDocument();
		expect(newButton.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(
			newButton.compareDocumentPosition(groupingHeaderEl) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(groupingHeaderEl.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(newButton.textContent).toBe("New session");
		await expect
			.element(screen.getByRole("button", { name: "Session list options" }))
			.toBeVisible();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await expect.element(page.getByRole("menuitem", { name: /^Status/ })).toBeVisible();
		await expect
			.element(page.getByRole("menuitem", { name: /^Workspace/ }))
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		await workspaceFilter.click();
		await expect.element(page.getByRole("option", { name: "All workspaces" })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Acme App/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Beta/ })).toBeVisible();
		const allIcon = page
			.getByRole("option", { name: "All workspaces" })
			.element()
			.querySelector(".lucide-layout-grid");
		expect(allIcon).not.toBeNull();
		const acmeIcon = page
			.getByRole("option", { name: /Acme App/ })
			.element()
			.querySelector(".lucide-folder");
		expect(acmeIcon).not.toBeNull();
		expect(acmeIcon?.getAttribute("stroke")).toBe("#F87171");
		const betaIcon = page
			.getByRole("option", { name: /Beta/ })
			.element()
			.querySelector(".lucide-folder");
		expect(betaIcon).not.toBeNull();
		expect(betaIcon?.getAttribute("stroke")).toBe("currentColor");
		await expect
			.element(page.getByRole("option", { name: "Don't work in a workspace" }))
			.not.toBeInTheDocument();
	});

	it("focuses the inbox on a workspace and sets it as the new-chat target", async () => {
		const { screen, setActiveWorkspaceId } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", workspaceId: "ws-1" },
					{ id: "ses-2", workspaceId: "ws-2" },
				]);
			},
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();

		const workspaceFilter = screen.getByRole("combobox", { name: "Filter by workspace" });
		await workspaceFilter.click();
		await page.getByRole("option", { name: /Acme App/ }).click();

		await expect.element(workspaceFilter).toHaveTextContent("Acme App");
		const switcherIcon = workspaceFilter.element().querySelector("svg");
		expect(switcherIcon?.classList.contains("lucide-folder")).toBe(true);
		expect(switcherIcon?.getAttribute("stroke")).toBe("#F87171");
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).not.toBeInTheDocument();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-1");

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Grouping/ }).click();
		await expect.element(page.getByRole("menuitemradio", { name: "Status" })).toBeVisible();
		await expect.element(page.getByRole("menuitemradio", { name: "Updated" })).toBeVisible();
		await expect
			.element(page.getByRole("menuitemradio", { name: "Workspace" }))
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("{Escape}");

		await workspaceFilter.click();
		await page.getByRole("option", { name: "All workspaces" }).click();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		expect(setActiveWorkspaceId).toHaveBeenLastCalledWith(null);
		expect(setActiveWorkspaceId).toHaveBeenCalledTimes(2);
		await expect.element(workspaceFilter).toHaveTextContent("All workspaces");
		const allIcon = workspaceFilter.element().querySelector("svg");
		expect(allIcon?.classList.contains("lucide-layout-grid")).toBe(true);
		expect(allIcon?.getAttribute("stroke")).toBe("currentColor");
	});

	it("focuses the inbox on chats without a workspace and targets new chats there", async () => {
		const { screen, setActiveWorkspaceId } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Loose question" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }, { id: "ses-2" }]);
			},
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Loose question")).toBeVisible();

		const workspaceFilter = screen.getByRole("combobox", { name: "Filter by workspace" });
		await workspaceFilter.click();
		const options = page.getByRole("option").elements();
		expect(options.slice(0, 2).map((option) => option.textContent)).toEqual([
			"All workspaces",
			"No workspace",
		]);
		await page.getByRole("option", { name: "No workspace" }).click();

		await expect.element(workspaceFilter).toHaveTextContent("No workspace");
		expect(
			workspaceFilter.element().querySelector("svg")?.classList.contains("lucide-folder-x"),
		).toBe(true);
		await expect.element(screen.getByText("Loose question")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		expect(setActiveWorkspaceId).toHaveBeenLastCalledWith(null);

		await workspaceFilter.click();
		await expect
			.element(page.getByRole("option", { name: "No workspace" }))
			.toHaveAttribute("data-checked", "true");
		await expect
			.element(page.getByRole("option", { name: "All workspaces" }))
			.toHaveAttribute("data-checked", "false");
	});

	it("explains an empty list while focused on chats without a workspace", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		await screen.getByRole("combobox", { name: "Filter by workspace" }).click();
		await page.getByRole("option", { name: "No workspace" }).click();

		await expect.element(screen.getByText("No sessions outside a workspace")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
	});
});

describe("SessionList worktree deletion", () => {
	const WORKTREE_DIRECTORY = "/repo/.kilo/worktrees/kilo-aback-aardvark";

	async function deleteViaRowMenu(screen: ReturnType<typeof page.elementLocator>, title: string) {
		const card = screen.getByRole("listitem").filter({ hasText: title });
		await expect.element(card).toBeVisible();
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
	}

	it("offers a confirm dialog for an orphaned worktree session; keep deletes only the session", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});

		await deleteViaRowMenu(screen, "Worktree chat");
		await expect.element(page.getByTestId("session-delete-worktree-dialog")).toBeVisible();
		const items = page.getByTestId("session-delete-worktree-items");
		await expect.element(items.getByText("Worktree chat")).toBeVisible();
		await expect.element(items.getByText("kilo/aback-aardvark")).toBeVisible();

		await page.getByTestId("session-delete-keep-worktree").click();

		await expect
			.element(page.getByTestId("session-delete-worktree-dialog"))
			.not.toBeInTheDocument();
		expect(adapter.deleteCalls).toEqual(["ses-1"]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("sizes the dialog so every footer button stays within its bounds", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree: vi.fn(async () => undefined),
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});

		await deleteViaRowMenu(screen, "Worktree chat");
		await expect.element(page.getByTestId("session-delete-worktree-dialog")).toBeVisible();

		const dialog = page.getByTestId("session-delete-worktree-dialog").element();
		const dialogRect = dialog.getBoundingClientRect();
		const buttons = dialog.querySelectorAll("[data-slot='alert-dialog-footer'] button");
		expect(buttons.length).toBe(3);
		for (const button of buttons) {
			const rect = button.getBoundingClientRect();
			expect(rect.left).toBeGreaterThanOrEqual(dialogRect.left - 0.5);
			expect(rect.right).toBeLessThanOrEqual(dialogRect.right + 0.5);
			expect(rect.top).toBeGreaterThanOrEqual(dialogRect.top - 0.5);
			expect(rect.bottom).toBeLessThanOrEqual(dialogRect.bottom + 0.5);
		}
	});

	it("removes the worktree after confirming the dialog", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});

		await deleteViaRowMenu(screen, "Worktree chat");
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => {
			expect(adapter.deleteCalls).toEqual(["ses-1"]);
		});
		await vi.waitFor(() => {
			expect(removeWorktree).toHaveBeenCalledWith({ directory: WORKTREE_DIRECTORY });
		});
		await vi.waitFor(() => {
			expect(toastApi.success).toHaveBeenCalledWith(
				"Worktree deleted",
				expect.objectContaining({ description: expect.stringContaining("kilo/aback-aardvark") }),
			);
		});
	});

	it("deletes a worktree session that shares its directory with another session after the chat confirm", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Shared one" },
				{ remoteId: "ses-2", title: "Shared two" },
			],
			removeWorktree,
			hydrate: (store) => {
				store.getState().hydrateSessions([
					{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					{ id: "ses-2", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
				]);
			},
		});

		await deleteViaRowMenu(screen, "Shared one");
		await confirmChatDelete();

		await expect
			.element(page.getByTestId("session-delete-worktree-dialog"))
			.not.toBeInTheDocument();
		expect(adapter.deleteCalls).toEqual(["ses-1"]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("deletes sessions without a worktree stamp after the chat confirm", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Local chat" }],
			removeWorktree,
		});

		await deleteViaRowMenu(screen, "Local chat");
		await confirmChatDelete();

		await expect
			.element(page.getByTestId("session-delete-worktree-dialog"))
			.not.toBeInTheDocument();
		expect(adapter.deleteCalls).toEqual(["ses-1"]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("surfaces a removal failure as an error toast while the session is still deleted", async () => {
		const removeWorktree = vi.fn(async () => {
			throw new Error("fatal: worktree is locked");
		});
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});

		await deleteViaRowMenu(screen, "Worktree chat");
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => {
			expect(adapter.deleteCalls).toEqual(["ses-1"]);
		});
		await vi.waitFor(() => {
			expect(toastApi.error).toHaveBeenCalledWith(
				"Could not remove worktree",
				expect.objectContaining({ description: "fatal: worktree is locked" }),
			);
		});
	});

	it("surfaces a failed session delete as an error toast and keeps the worktree", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const unhandled = vi.fn();
		window.addEventListener("unhandledrejection", unhandled);
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});
		adapter.deleteError = new Error("network unreachable");

		await deleteViaRowMenu(screen, "Worktree chat");
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => {
			expect(toastApi.error).toHaveBeenCalledWith(
				"Could not delete session",
				expect.objectContaining({ description: "network unreachable" }),
			);
		});
		// The session survived, so its worktree must not be removed.
		expect(adapter.deleteCalls).toEqual(["ses-1"]);
		expect(removeWorktree).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(unhandled).not.toHaveBeenCalled();
		window.removeEventListener("unhandledrejection", unhandled);
	});

	it("waits for the refresh before deleting a not-yet-hydrated session", async () => {
		// Startup window: the row rendered before any session stamp arrived,
		// so the orphan selector says "not a worktree" — the delete must wait
		// for the refresh to settle before deciding.
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen, store } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			skipDefaultHydration: true,
		});

		await expect.element(screen.getByText("Worktree chat")).toBeVisible();
		await deleteViaRowMenu(screen, "Worktree chat");
		await confirmChatDelete();

		// Direct delete must not have happened: the store has no record yet
		// and the refresh has not settled.
		expect(adapter.deleteCalls).toEqual([]);

		// The refresh lands mid-decide: the stamp reveals a worktree session.
		act(() => {
			store.getState().hydrateSessions([
				{
					id: "ses-1",
					directory: WORKTREE_DIRECTORY,
					worktreeBranch: "kilo/aback-aardvark",
				},
			]);
			store.getState().markSessionsRefreshed();
		});

		await expect.element(page.getByTestId("session-delete-worktree-dialog")).toBeVisible();
		expect(adapter.deleteCalls).toEqual([]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("waits for the refresh when the record exists but lacks a worktree stamp", async () => {
		// The session record was partially hydrated (directory only, no
		// worktreeBranch) before the full refresh settled. The delete must
		// wait for the refresh rather than deleting directly.
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen, store } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			skipDefaultHydration: true,
			hydrate: (s) => {
				s.getState().hydrateSessions([{ id: "ses-1", directory: WORKTREE_DIRECTORY }]);
			},
		});

		await expect.element(screen.getByText("Worktree chat")).toBeVisible();
		await deleteViaRowMenu(screen, "Worktree chat");
		await confirmChatDelete();

		// The record exists but has no worktree stamp and the refresh has not
		// settled — the delete must not have proceeded yet.
		expect(adapter.deleteCalls).toEqual([]);

		// The full refresh lands: the stamp reveals a worktree session.
		act(() => {
			store.getState().hydrateSessions([
				{
					id: "ses-1",
					directory: WORKTREE_DIRECTORY,
					worktreeBranch: "kilo/aback-aardvark",
				},
			]);
			store.getState().markSessionsRefreshed();
		});

		await expect.element(page.getByTestId("session-delete-worktree-dialog")).toBeVisible();
		expect(adapter.deleteCalls).toEqual([]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("deletes directly when the settled refresh shows no worktree stamp", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen, store } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Local chat" }],
			removeWorktree,
			skipDefaultHydration: true,
		});
		store.getState().markSessionsRefreshed();

		await deleteViaRowMenu(screen, "Local chat");
		await confirmChatDelete();

		await vi.waitFor(() => {
			expect(adapter.deleteCalls).toEqual(["ses-1"]);
		});
		expect(removeWorktree).not.toHaveBeenCalled();
	});

	it("cancel closes the dialog without deleting anything", async () => {
		const removeWorktree = vi.fn(async () => undefined);
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Worktree chat" }],
			removeWorktree,
			hydrate: (store) => {
				store
					.getState()
					.hydrateSessions([
						{ id: "ses-1", directory: WORKTREE_DIRECTORY, worktreeBranch: "kilo/aback-aardvark" },
					]);
			},
		});

		await deleteViaRowMenu(screen, "Worktree chat");
		await page.getByTestId("session-delete-worktree-cancel").click();

		await expect
			.element(page.getByTestId("session-delete-worktree-dialog"))
			.not.toBeInTheDocument();
		expect(adapter.deleteCalls).toEqual([]);
		expect(removeWorktree).not.toHaveBeenCalled();
	});
});

describe("SessionList board actions", () => {
	it("opens the board from the toggle in the workspace header", async () => {
		const { screen, navigate } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: DEFAULT_WORKSPACE_BOARD,
		});
		const header = screen.getByTestId("session-list-grouping-header");
		const toggle = header.getByRole("button", { name: "Workspace Board" });
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

		await toggle.click();
		expect(navigate).toHaveBeenCalledWith(WORKSPACE_BOARD_ROUTE_PATH, undefined);
	});

	it("goes back to the chat when the toggle is pressed on the board", async () => {
		const { screen, navigate } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: DEFAULT_WORKSPACE_BOARD,
			path: WORKSPACE_BOARD_ROUTE_PATH,
		});
		const toggle = screen.getByRole("button", { name: "Workspace Board" });
		await expect.element(toggle).toHaveAttribute("aria-pressed", "true");

		await toggle.click();
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("brings the board's window forward while the board is popped out", async () => {
		const focusPaneWindow = vi.fn(async () => ({ focused: true }));
		const { screen, navigate } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: DEFAULT_WORKSPACE_BOARD,
			shell: {
				listPaneWindows: async () => [
					{
						pluginId: "kilo-ui",
						paneId: "workspace-board",
						title: "Workspace Board",
						path: WORKSPACE_BOARD_ROUTE_PATH,
					},
				],
				focusPaneWindow,
			},
		});
		const toggle = screen.getByRole("button", { name: "Workspace Board" });
		await toggle.hover();
		await expect.element(page.getByText("Bring Workspace Board to front")).toBeVisible();
		// It brings a window forward rather than toggling, so it is not a pressed/unpressed toggle.
		await expect.element(toggle).not.toHaveAttribute("aria-pressed");

		await toggle.click();
		expect(focusPaneWindow).toHaveBeenCalledWith({
			pluginId: "kilo-ui",
			paneId: "workspace-board",
		});
		expect(navigate).not.toHaveBeenCalled();
	});

	it("offers no board actions while the board is off", async () => {
		const { screen } = renderSessionList({ threads: [{ remoteId: "ses-1", title: "Fix login" }] });
		await expect.element(screen.getByTestId("session-list-search")).toBeVisible();
		await expect.element(screen.getByTestId("session-list-board")).not.toBeInTheDocument();
		const card = screen.getByRole("listitem").filter({ hasText: "Fix login" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
		await expect.element(page.getByTestId("session-list-item-board-menu")).not.toBeInTheDocument();
	});

	it("adds a chat to a board column from its menu, which then offers to move it", async () => {
		const { screen, board } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: DEFAULT_WORKSPACE_BOARD,
		});
		const card = screen.getByRole("listitem").filter({ hasText: "Fix login" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByTestId("session-list-item-board-menu").click();
		await page.getByTestId("session-list-item-board-review").click();

		await vi.waitFor(() =>
			expect(board().columns.find((column) => column.id === "review")?.sessionIds).toEqual([
				"ses-1",
			]),
		);
		await userEvent.keyboard("{Escape}{Escape}");
		await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await expect
			.element(page.getByTestId("session-list-item-board-menu"))
			.toHaveTextContent("Move on board");
	});

	it("takes a deleted chat off the board", async () => {
		const { screen, board, adapter } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: placeSession(DEFAULT_WORKSPACE_BOARD, "ses-1", "done", 0),
		});
		const card = screen.getByRole("listitem").filter({ hasText: "Fix login" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await confirmChatDelete();

		await vi.waitFor(() => expect(adapter.deleteCalls).toEqual(["ses-1"]));
		await vi.waitFor(() => expect(board()).toEqual(DEFAULT_WORKSPACE_BOARD));
	});

	it("removes a chat from the board from its menu", async () => {
		const { screen, board } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix login" }],
			board: placeSession(DEFAULT_WORKSPACE_BOARD, "ses-1", "done", 0),
		});
		const card = screen.getByRole("listitem").filter({ hasText: "Fix login" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Thread actions" }).click();
		await page.getByTestId("session-list-item-board-remove").click();

		await vi.waitFor(() => expect(board()).toEqual(DEFAULT_WORKSPACE_BOARD));
	});
});
