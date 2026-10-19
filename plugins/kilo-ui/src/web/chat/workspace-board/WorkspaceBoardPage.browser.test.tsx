import {
	AssistantRuntimeProvider,
	useAuiState,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { SDK } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { WorkspaceBoardState } from "../../../contracts/workspace-board/board-model.js";
import { workspaceBoardContract } from "../../../contracts/workspace-board/schemas.js";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../../workspaces/WorkspacesFeatureContext.js";
import type { SessionRowMetadataProps } from "../components/assistant-ui/session-row-display.js";
import { SessionActivityProvider } from "../session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";
import {
	DEFAULT_SESSION_LIST_VIEW,
	SESSION_LIST_VIEW_STORAGE_KEY,
} from "../session-list/session-list-view.js";
import {
	SessionListViewProvider,
	useSessionListPins,
} from "../session-list/use-session-list-view.js";
import { WorkspaceBoardHeaderActions } from "./WorkspaceBoardHeaderActions.js";
import { WorkspaceBoardPage } from "./WorkspaceBoardPage.js";
import { WorkspaceBoardProvider } from "./WorkspaceBoardProvider.js";
import { WorkspaceBoardWindowBridge } from "./WorkspaceBoardWindowBridge.js";
import {
	WORKSPACE_BOARD_DOCKED_EVENT,
	WORKSPACE_BOARD_OPEN_SESSION_EVENT,
} from "./workspace-board-window.js";
import { createWorkspaceBoardBackend, workspaceBoardFlags } from "./test-helpers.js";

const stubChatModel: ChatModelAdapter = {
	async run() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

const threads = [
	{ remoteId: "ses_acme", title: "Acme bug", status: "regular" as const },
	{ remoteId: "ses_beta", title: "Beta feature", status: "regular" as const },
	{ remoteId: "ses_old", title: "Old notes", status: "archived" as const },
];

const thread = (remoteId: string) => {
	const record = threads.find((candidate) => candidate.remoteId === remoteId);
	return record ? Promise.resolve({ ...record }) : Promise.reject(new Error("Not found"));
};

const archiveThread = vi.fn(async (_remoteId: string) => undefined);
const renameThread = vi.fn(async (_remoteId: string, _title: string) => undefined);
const deleteThread = vi.fn(async (_remoteId: string) => undefined);

const adapter: RemoteThreadListAdapter = {
	list: () => Promise.resolve({ threads: threads.map((record) => ({ ...record })) }),
	archive: archiveThread,
	unarchive: () => Promise.resolve(),
	rename: renameThread,
	delete: deleteThread,
	initialize: (threadId) => Promise.resolve({ remoteId: threadId, externalId: undefined }),
	generateTitle: () =>
		Promise.resolve(new ReadableStream({ start: (controller) => controller.close() })),
	fetch: thread,
};

const workspaces: WorkspacesContextValue = {
	workspaces: [
		{ id: "ws-acme", name: "Acme", folders: [], createdAt: 0, updatedAt: 0 },
		{ id: "ws-beta", name: "Beta", color: "#F87171", folders: [], createdAt: 0, updatedAt: 0 },
	],
	activeWorkspaceId: null,
	setActiveWorkspaceId: () => undefined,
	isLoading: false,
	isUnavailable: false,
	openCreate: () => undefined,
	openEdit: () => undefined,
	openDelete: () => undefined,
};

const board: WorkspaceBoardState = {
	columns: [
		{ id: "backlog", label: "Backlog", sessionIds: ["ses_acme", "ses_unloaded"] },
		{ id: "done", label: "Done", sessionIds: ["ses_beta", "ses_old"] },
	],
};

function PinsProbe() {
	const { ids } = useSessionListPins();
	return <output data-qa-id="pins">{ids.join(",")}</output>;
}

function MainThreadProbe() {
	const remoteId = useAuiState(
		(s) => s.threads.threadItems.find((item) => item.id === s.threads.mainThreadId)?.remoteId,
	);
	return <output data-qa-id="main-thread">{remoteId ?? "draft"}</output>;
}

function Harness({
	system,
	store,
	shellHeader,
}: {
	system: ReturnType<typeof createFakeFeatureSystem>;
	store: ReturnType<typeof createSessionActivityStore>;
	shellHeader: boolean;
}) {
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});
	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<SessionActivityProvider store={store}>
					<WorkspacesContext.Provider value={workspaces}>
						<SessionListViewProvider>
							<WorkspaceBoardProvider>
								<WorkspaceBoardWindowBridge />
								{/* The main window's shell renders the route's header actions in the title bar. */}
								{shellHeader ? <WorkspaceBoardHeaderActions /> : null}
								<div className="h-[480px]">
									<WorkspaceBoardPage />
								</div>
								<MainThreadProbe />
								<PinsProbe />
							</WorkspaceBoardProvider>
						</SessionListViewProvider>
					</WorkspacesContext.Provider>
				</SessionActivityProvider>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

function setup({
	enabled = true,
	shell,
}: {
	enabled?: boolean;
	shell?: Partial<SDK["shell"]>;
} = {}) {
	const store = createSessionActivityStore({ storage: null });
	store.getState().hydrateSessions([
		{ id: "ses_acme", directory: "/repo/acme", workspaceId: "ws-acme" },
		{ id: "ses_beta", directory: "/repo/beta", workspaceId: "ws-beta" },
	]);
	store.getState().markSessionsRefreshed();
	const navigate = vi.fn();
	const backend = createWorkspaceBoardBackend(board);
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspaceBoardContract,
		handlers: backend.handlers,
		featureFlags: workspaceBoardFlags(enabled),
		navigation: { navigate },
		...(shell ? { shell } : {}),
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	system.getSdk("metadata-probe").contribute("kilo-ui/chat-session-row-metadata", {
		id: "probe",
		label: "PR status",
		component: ({ directory, interactive }: SessionRowMetadataProps) => (
			<span
				data-qa-id={`row-metadata-${directory}`}
				className={interactive ? "pointer-events-auto" : undefined}
			>
				{interactive ? "interactive" : "inert"}
			</span>
		),
	});
	system.getSdk("metadata-probe").contribute("kilo-ui/chat-session-metadata-provider", {
		id: "probe-targets",
		label: "PR status targets",
		component: ({ targets }: { targets: readonly { directory: string }[] }) => (
			<output data-qa-id="metadata-targets">
				{targets.map((target) => target.directory).join(",")}
			</output>
		),
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<Harness system={system} store={store} shellHeader={shell?.windowRole !== "pane"} />
		</QueryClientProvider>,
	);
	return { screen: page.elementLocator(baseElement), navigate, backend, sdk };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
	for (const spy of [archiveThread, renameThread, deleteThread]) spy.mockClear();
	vi.restoreAllMocks();
});

describe("WorkspaceBoardPage", () => {
	it("shows placed chats in their columns and skips chats that are not loaded", async () => {
		const { screen } = setup();
		await expect
			.element(screen.getByTestId("workspace-board-column-backlog").getByText("Acme bug"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("workspace-board-column-done").getByText("Beta feature"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("workspace-board-column-count-backlog"))
			.toHaveTextContent("1");
	});

	it("fills the page height, so its columns scroll rather than the page", async () => {
		const { screen } = setup();
		await expect.element(screen.getByText("Acme bug")).toBeVisible();
		const board = screen.getByTestId("workspace-board").element().getBoundingClientRect();
		expect(board.height).toBe(480);
	});

	it("follows the sidebar's workspace focus", async () => {
		localStorage.setItem(
			SESSION_LIST_VIEW_STORAGE_KEY,
			JSON.stringify({ ...DEFAULT_SESSION_LIST_VIEW, focus: "ws-beta" }),
		);
		const { screen } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await expect.element(screen.getByText("Acme bug")).not.toBeInTheDocument();
	});

	it("opens a card's chat in the chat page", async () => {
		const { screen, navigate } = setup();
		await screen.getByRole("button", { name: "Open Beta feature in Beta" }).click();
		await expect.element(screen.getByTestId("main-thread")).toHaveTextContent("ses_beta");
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("renders a card's row metadata as interactive", async () => {
		const { screen } = setup();
		const card = screen.getByTestId("workspace-board-card-ses_beta");
		await expect
			.element(card.getByTestId("row-metadata-/repo/beta"))
			.toHaveTextContent("interactive");
	});

	it("leaves which chats' pull requests to look up to the sidebar beside it", async () => {
		const { screen } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await expect.element(screen.getByTestId("metadata-targets")).not.toBeInTheDocument();
	});

	it("puts the row metadata, not the card, under the pointer, so a PR link takes the click", async () => {
		const { screen } = setup();
		const metadata = screen
			.getByTestId("workspace-board-card-ses_beta")
			.getByTestId("row-metadata-/repo/beta");
		await expect.element(metadata).toBeVisible();
		metadata.element().scrollIntoView({ block: "center", inline: "center" });
		const rect = metadata.element().getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		expect(metadata.element().contains(hit)).toBe(true);
	});

	it("explains that the board is unavailable while its feature flag is off", async () => {
		const { screen } = setup({ enabled: false });
		await expect.element(screen.getByTestId("workspace-board-unavailable")).toBeVisible();
	});
});

describe("WorkspaceBoardPage card actions", () => {
	async function openCardMenu(screen: ReturnType<typeof setup>["screen"], sessionId: string) {
		const card = screen.getByTestId(`workspace-board-card-${sessionId}`);
		await expect.element(card).toBeVisible();
		await card.hover();
		await card.getByRole("button", { name: /^Chat actions for / }).click();
		return card;
	}

	it("groups the chat actions, then the board actions, then Delete on its own", async () => {
		const { screen } = setup();
		await openCardMenu(screen, "ses_beta");
		const menu = page.getByRole("menu");
		await expect.element(menu).toBeVisible();
		const entries = [...menu.element().querySelectorAll("[role=menuitem], [role=separator]")].map(
			(entry) => (entry.getAttribute("role") === "separator" ? "—" : entry.textContent?.trim()),
		);
		expect(entries).toEqual([
			"Pin",
			"Archive",
			"Rename",
			"—",
			"Move on board",
			"Remove from board",
			"—",
			"Delete",
		]);
	});

	it("names the chat on each card's menu button", async () => {
		const { screen } = setup();
		const card = screen.getByTestId("workspace-board-card-ses_beta");
		await expect.element(card).toBeVisible();
		await card.hover();
		await expect
			.element(card.getByRole("button", { name: "Chat actions for Beta feature" }))
			.toBeInTheDocument();
	});

	it("offers an archived chat's menu without Pin or Archive", async () => {
		const { screen } = setup();
		await openCardMenu(screen, "ses_old");
		const menu = page.getByRole("menu");
		await expect.element(menu).toBeVisible();
		const items = [...menu.element().querySelectorAll("[role=menuitem]")].map((item) =>
			item.textContent?.trim(),
		);
		expect(items).toEqual(["Rename", "Move on board", "Remove from board", "Delete"]);
	});

	it("puts the menu button, not the card, under the pointer when hovering it", async () => {
		const { screen } = setup();
		const card = screen.getByTestId("workspace-board-card-ses_beta");
		await expect.element(card).toBeVisible();
		await card.hover();
		const trigger = card.getByRole("button", { name: /^Chat actions for / }).element();
		await vi.waitFor(() => expect(trigger.getBoundingClientRect().width).toBeGreaterThan(0));
		const rect = trigger.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		expect(trigger.contains(hit)).toBe(true);
	});

	it("removes the chat from the board", async () => {
		const { screen, backend } = setup();
		await openCardMenu(screen, "ses_beta");
		await page.getByRole("menuitem", { name: "Remove from board" }).click();

		await expect.element(screen.getByText("Beta feature")).not.toBeInTheDocument();
		await vi.waitFor(() =>
			expect(backend.stored().columns.flatMap((column) => column.sessionIds)).not.toContain(
				"ses_beta",
			),
		);
		expect(deleteThread).not.toHaveBeenCalled();
	});

	it("renames the chat in place", async () => {
		const { screen } = setup();
		const card = await openCardMenu(screen, "ses_beta");
		await page.getByRole("menuitem", { name: "Rename" }).click();
		await card.getByRole("textbox", { name: "Rename thread" }).fill("Beta launch");
		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() => expect(renameThread).toHaveBeenCalledWith("ses_beta", "Beta launch"));
		await expect.element(card.getByText("Beta launch")).toBeVisible();
		await expect.element(card.getByRole("button", { name: /^Chat actions for / })).toHaveFocus();
	});

	it("deletes the chat and takes it off the board", async () => {
		const { screen, backend } = setup();
		await openCardMenu(screen, "ses_beta");
		await page.getByRole("menuitem", { name: "Delete" }).click();

		await vi.waitFor(() => expect(deleteThread).toHaveBeenCalledWith("ses_beta"));
		await expect.element(screen.getByText("Beta feature")).not.toBeInTheDocument();
		await vi.waitFor(() =>
			expect(backend.stored().columns.flatMap((column) => column.sessionIds)).not.toContain(
				"ses_beta",
			),
		);
	});

	it("archives the chat", async () => {
		const { screen } = setup();
		await openCardMenu(screen, "ses_beta");
		await page.getByRole("menuitem", { name: "Archive" }).click();
		await vi.waitFor(() => expect(archiveThread).toHaveBeenCalledWith("ses_beta"));
	});

	it("pins the chat for the sidebar too", async () => {
		const { screen } = setup();
		await openCardMenu(screen, "ses_beta");
		await page.getByRole("menuitem", { name: "Pin" }).click();
		await expect.element(screen.getByTestId("pins")).toHaveTextContent("ses_beta");

		await openCardMenu(screen, "ses_beta");
		await expect.element(page.getByRole("menuitem", { name: "Unpin" })).toBeVisible();
	});

	it("counts chats the board is not showing when confirming a column delete", async () => {
		localStorage.setItem(
			SESSION_LIST_VIEW_STORAGE_KEY,
			JSON.stringify({ ...DEFAULT_SESSION_LIST_VIEW, focus: "ws-beta" }),
		);
		const { screen } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await screen.getByTestId("workspace-board-column-header-backlog").hover();
		await screen.getByTestId("workspace-board-column-menu-backlog").click();
		await page.getByTestId("workspace-board-column-delete-action").click();

		const dialog = page.getByTestId("workspace-board-column-delete-dialog");
		await expect.element(dialog).toBeVisible();
		expect(dialog.element().textContent).toContain(
			"This moves its 2 chats (2 not shown) to “Done”",
		);
	});
});

describe("WorkspaceBoardPage clear board", () => {
	const placedIds = (backend: ReturnType<typeof setup>["backend"]) =>
		backend.stored().columns.flatMap((column) => column.sessionIds);

	it("takes every chat off the board after confirming, and keeps the columns", async () => {
		const { screen, backend } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await screen.getByRole("button", { name: "Clear board" }).click();

		const dialog = page.getByTestId("workspace-board-clear-dialog");
		await expect.element(dialog).toBeVisible();
		// Counts chats that are not shown too (an unloaded one here).
		expect(dialog.element().textContent).toContain("This takes all 4 chats off the board.");
		await page.getByTestId("workspace-board-clear-confirm").click();

		await expect.element(screen.getByText("Beta feature")).not.toBeInTheDocument();
		await vi.waitFor(() => expect(placedIds(backend)).toEqual([]));
		expect(backend.stored().columns.map((column) => column.id)).toEqual(["backlog", "done"]);
		const clear = screen.getByRole("button", { name: "Clear board" });
		await expect.element(clear).toBeDisabled();
		await expect.element(clear).toHaveAttribute("aria-description", "The board is already empty");
	});

	it("leaves the board as it was when clearing is cancelled", async () => {
		const { screen, backend } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await screen.getByRole("button", { name: "Clear board" }).click();
		await page.getByRole("button", { name: "Cancel" }).click();

		await expect.element(page.getByTestId("workspace-board-clear-dialog")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		expect(placedIds(backend)).toEqual(["ses_acme", "ses_unloaded", "ses_beta", "ses_old"]);
	});
});

describe("WorkspaceBoardPage in its own window", () => {
	const boardWindow = {
		pluginId: "kilo-ui",
		paneId: "workspace-board",
		title: "Workspace Board",
		path: "/plugins/workspace-board",
	};
	const boardWindowIdentity = { pluginId: "kilo-ui", paneId: "workspace-board" };
	/** The columns' span, with the margin before the first column repeated after the last. */
	const columnsWidth = () => {
		const strip = document
			.querySelector<HTMLElement>("[data-workspace-board-columns]")!
			.getBoundingClientRect();
		const columns = [
			...document.querySelectorAll<HTMLElement>("[data-workspace-board-column]"),
		].map((column) => column.getBoundingClientRect());
		const first = columns[0]!;
		const margin = first.left - strip.left;
		return Math.ceil(columns.at(-1)!.right - first.left + 2 * margin);
	};

	it("pops the board out into its own window and returns the main window to the chat", async () => {
		const openPaneWindow = vi.fn(async () => ({ opened: true }));
		const { screen, navigate } = setup({ shell: { openPaneWindow } });
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		const width = columnsWidth();

		await screen.getByRole("button", { name: "Pop out" }).click();

		// Wide enough for every column, so the board's window opens without a sideways scrollbar.
		await vi.waitFor(() => expect(openPaneWindow).toHaveBeenCalledWith({ ...boardWindow, width }));
		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined));
		await expect.element(screen.getByTestId("workspace-board-popped-out")).toBeVisible();
		await expect.element(screen.getByText("Beta feature")).not.toBeInTheDocument();
	});

	it("opens the board's window only as wide as its columns when the board has room to spare", async () => {
		await page.viewport(1400, 800);
		const openPaneWindow = vi.fn(async () => ({ opened: true }));
		const { screen } = setup({ shell: { openPaneWindow } });
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		const width = columnsWidth();
		const strip = document.querySelector<HTMLElement>("[data-workspace-board-columns]")!;
		expect(width).toBeLessThan(strip.clientWidth);

		await screen.getByRole("button", { name: "Pop out" }).click();

		await vi.waitFor(() => expect(openPaneWindow).toHaveBeenCalledWith({ ...boardWindow, width }));
	});

	it("stays on the board and says so when its window cannot open", async () => {
		const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
		const { screen, navigate } = setup({
			shell: { openPaneWindow: async () => Promise.reject(new Error("No display")) },
		});
		await expect.element(screen.getByText("Beta feature")).toBeVisible();

		await screen.getByRole("button", { name: "Pop out" }).click();

		await vi.waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("Could not pop out the board", {
				description: "No display",
			}),
		);
		expect(navigate).not.toHaveBeenCalled();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
	});

	it("offers no pop-out where the app cannot open windows", async () => {
		const { screen } = setup({ shell: { canPopOutPanes: false } });
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Pop out" })).not.toBeInTheDocument();
	});

	it("points to the board's window while it is open, and brings the board back", async () => {
		const focusPaneWindow = vi.fn(async () => ({ focused: true }));
		const dockPaneWindow = vi.fn(async () => ({ docked: true }));
		const { screen, navigate } = setup({
			shell: {
				listPaneWindows: async () => [boardWindow],
				focusPaneWindow,
				dockPaneWindow,
			},
		});
		const placeholder = screen.getByTestId("workspace-board-popped-out");
		await expect.element(placeholder).toBeVisible();
		// The board's actions belong with it, in its own window.
		for (const name of ["Add column", "Clear board", "Pop out"]) {
			await expect.element(screen.getByRole("button", { name })).not.toBeInTheDocument();
		}

		await placeholder.getByRole("button", { name: "Bring to front" }).click();
		expect(focusPaneWindow).toHaveBeenCalledWith(boardWindowIdentity);

		await placeholder.getByRole("button", { name: "Dock" }).click();
		expect(dockPaneWindow).toHaveBeenCalledWith(boardWindowIdentity);
		expect(navigate).toHaveBeenCalledWith("/plugins/workspace-board", undefined);
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
	});

	it("shows the board again once its window is closed", async () => {
		let notify!: Parameters<SDK["shell"]["onPaneWindowChanged"]>[0];
		const { screen } = setup({
			shell: {
				listPaneWindows: async () => [boardWindow],
				onPaneWindowChanged: (listener) => {
					notify = listener;
					return () => undefined;
				},
			},
		});
		await expect.element(screen.getByTestId("workspace-board-popped-out")).toBeVisible();

		// A chat pane's window closing is not the board's.
		notify({ type: "docked", pluginId: "kilo-ui", sessionId: "ses_beta", paneId: "file:a" });
		await expect.element(screen.getByTestId("workspace-board-popped-out")).toBeVisible();

		notify({ type: "docked", ...boardWindowIdentity });
		await expect.element(screen.getByText("Beta feature")).toBeVisible();
	});

	it("opens a chat the popped-out board asks for in the main window", async () => {
		const { screen, navigate, sdk } = setup();
		await expect.element(screen.getByText("Beta feature")).toBeVisible();

		sdk.events.emit(WORKSPACE_BOARD_OPEN_SESSION_EVENT, { sessionId: "ses_beta" });

		await expect.element(screen.getByTestId("main-thread")).toHaveTextContent("ses_beta");
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
	});

	it("shows the board when the popped-out board docks itself", async () => {
		const { screen, navigate, sdk } = setup({
			shell: { listPaneWindows: async () => [boardWindow] },
		});
		await expect.element(screen.getByTestId("workspace-board-popped-out")).toBeVisible();

		sdk.events.emit(WORKSPACE_BOARD_DOCKED_EVENT, undefined);

		await expect.element(screen.getByText("Beta feature")).toBeVisible();
		expect(navigate).toHaveBeenCalledWith("/plugins/workspace-board", undefined);
	});

	describe("as the popped-out window", () => {
		const paneShell = (overrides: Partial<SDK["shell"]> = {}) => ({
			windowRole: "pane" as const,
			...overrides,
		});

		it("draws its own title bar with the board's actions and no pop-out", async () => {
			const { screen } = setup({ shell: paneShell() });
			const header = screen.getByTestId("workspace-board-window-header");
			await expect.element(header).toBeVisible();
			await expect.element(header.getByText("Workspace Board")).toBeVisible();
			await expect.element(header.getByRole("button", { name: "Add column" })).toBeVisible();
			await expect.element(header.getByRole("button", { name: "Clear board" })).toBeVisible();
			await expect.element(header.getByRole("button", { name: "Dock" })).toBeVisible();
			await expect.element(screen.getByRole("button", { name: "Pop out" })).not.toBeInTheDocument();
			await expect.element(screen.getByText("Beta feature")).toBeVisible();
		});

		it("looks up its chats' pull requests itself, as no sidebar does so in its window", async () => {
			const { screen } = setup({ shell: paneShell() });
			await expect
				.element(screen.getByTestId("metadata-targets"))
				.toHaveTextContent("/repo/acme,/repo/beta");
		});

		it("names the sidebar's focused workspace in its title bar", async () => {
			localStorage.setItem(
				SESSION_LIST_VIEW_STORAGE_KEY,
				JSON.stringify({ ...DEFAULT_SESSION_LIST_VIEW, focus: "ws-beta" }),
			);
			const { screen } = setup({ shell: paneShell() });
			await expect
				.element(screen.getByTestId("workspace-board-window-header").getByText("Beta"))
				.toBeVisible();
		});

		it("docks back into the main window", async () => {
			const focusMainWindow = vi.fn(async () => undefined);
			const dockPaneWindow = vi.fn(async () => ({ docked: true }));
			const { screen, sdk } = setup({ shell: paneShell({ focusMainWindow, dockPaneWindow }) });
			const docked = vi.fn();
			sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_DOCKED_EVENT}`, docked);

			await screen.getByRole("button", { name: "Dock" }).click();

			expect(docked).toHaveBeenCalled();
			expect(focusMainWindow).toHaveBeenCalled();
			expect(dockPaneWindow).toHaveBeenCalledWith(boardWindowIdentity);
		});

		it("hands a card's chat to the main window instead of opening it here", async () => {
			const focusMainWindow = vi.fn(async () => undefined);
			const { screen, navigate, sdk } = setup({ shell: paneShell({ focusMainWindow }) });
			const requested = vi.fn();
			sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_OPEN_SESSION_EVENT}`, requested);

			await screen.getByRole("button", { name: "Open Beta feature in Beta" }).click();

			expect(requested).toHaveBeenCalledWith({ sessionId: "ses_beta" });
			expect(focusMainWindow).toHaveBeenCalled();
			expect(navigate).not.toHaveBeenCalled();
			await expect.element(screen.getByTestId("main-thread")).toHaveTextContent("draft");
		});
	});
});
