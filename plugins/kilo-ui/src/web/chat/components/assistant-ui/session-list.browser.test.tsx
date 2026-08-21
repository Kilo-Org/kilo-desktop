import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
	type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../../../workspaces/WorkspacesFeatureContext.js";
import { SessionActivityProvider } from "../../session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "../../session-activity/session-activity-store.js";
import { SessionList } from "./session-list.js";

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
	private readonly records: Required<SeededThread>[];

	constructor(threads: SeededThread[]) {
		this.records = threads.map((thread) => ({ status: "regular", ...thread }));
	}

	list() {
		return Promise.resolve({ threads: this.records.map((record) => ({ ...record })) });
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
}: {
	adapter: SeededThreadListAdapter;
	store: ReturnType<typeof createSessionActivityStore>;
	system: ReturnType<typeof createFakeFeatureSystem>;
	workspaces: WorkspacesContextValue;
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
						<SessionList />
					</WorkspacesContext.Provider>
				</SessionActivityProvider>
			</AssistantRuntimeProvider>
		</SdkProvider>
	);
}

function renderSessionList({
	threads,
	hydrate,
	activeWorkspaceId = null,
}: {
	threads: SeededThread[];
	hydrate?: (store: ReturnType<typeof createSessionActivityStore>) => void;
	activeWorkspaceId?: string | null;
}) {
	const adapter = new SeededThreadListAdapter(threads);
	const navigate = vi.fn();
	const setActiveWorkspaceId = vi.fn();
	const workspaces = { ...workspacesValue, activeWorkspaceId, setActiveWorkspaceId };
	const sdk = createFakeSdk({ featureId: "kilo-ui", navigation: { navigate } });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const store = createSessionActivityStore({ storage: null });
	store.getState().hydrateSessions(
		threads.map((thread, index) => ({
			id: thread.remoteId,
			directory: `/repo/${thread.remoteId}`,
			createdAt: 1_700_000_000_000 + index * 1000,
			updatedAt: 1_700_000_000_000 + index * 1000,
		})),
	);
	hydrate?.(store);
	const result = render(
		<SessionListHarness adapter={adapter} store={store} system={system} workspaces={workspaces} />,
	);
	return {
		adapter,
		navigate,
		setActiveWorkspaceId,
		store,
		screen: page.elementLocator(result.baseElement),
		...result,
	};
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("SessionList", () => {
	it("creates a chat from the New Chat split button", async () => {
		const { baseElement, navigate, screen } = renderSessionList({ threads: [] });

		await expect.element(page.getByTestId("kilo-thread-list")).toBeVisible();
		const trigger = screen.getByRole("button", { name: "New Chat" });
		await expect.element(trigger).toBeVisible();
		expect(baseElement.querySelector('[data-slot="aui_thread-list-new"]')).not.toBeNull();
		expect(baseElement.querySelector('[data-slot="aui_thread-list-items"]')?.className).toContain(
			"scroll-fade",
		);

		await trigger.click();
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenLastCalledWith("/plugins/chat", undefined);
		await expect.element(screen.getByRole("menuitem", { name: "Chat" })).not.toBeInTheDocument();
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

		await page.getByRole("combobox", { name: "Search chats and workspaces" }).fill("Add tests");
		await expect.element(page.getByRole("option", { name: /Add tests/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByRole("option", { name: /Add tests/ }).click();
		expect(navigate).toHaveBeenCalledWith("/plugins/chat", undefined);
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("preserves settled state when opening a chat from search", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Settled chat", status: "archived" }],
		});

		await screen.getByRole("button", { name: "Search" }).click();
		await page.getByRole("option", { name: /Settled chat/ }).click();

		const row = screen.getByRole("listitem").filter({ hasText: "Settled chat" });
		await vi.waitFor(() =>
			expect(
				row.element().querySelector('[data-slot="aui_session-list-settled-item"]')?.className,
			).toContain("bg-muted"),
		);
		expect(adapter.unarchiveCalls).toEqual([]);
	});

	it("toggles the search dialog with Meta+K", async () => {
		renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await userEvent.keyboard("{Meta>}k{/Meta}");
		await expect.element(page.getByRole("dialog")).toBeVisible();
		await userEvent.keyboard("{Meta>}k{/Meta}");
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
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

		await page.getByRole("combobox", { name: "Search chats and workspaces" }).fill("Beta");
		await expect.element(page.getByTestId("session-search-workspace-ws-2")).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).not.toBeInTheDocument();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByTestId("session-search-workspace-ws-2").click();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-2");
		await expect
			.element(screen.getByRole("combobox", { name: "Filter by workspace" }))
			.toHaveTextContent("Beta");
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

	it("filters search results with All, Chats, and Workspaces chips", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		await screen.getByRole("button", { name: "Search" }).click();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).toBeVisible();
		const all = page.getByRole("button", { name: "All" });
		const chats = page.getByRole("button", { name: "Chats" });
		expect(all.element().getAttribute("aria-pressed")).toBe("true");
		expect(chats.element().getAttribute("aria-pressed")).toBe("false");
		expect(all.element().className).not.toContain("border-input");
		expect(all.element().className).toContain("hover:bg-secondary");
		expect(all.element().className).toContain("aria-pressed:bg-secondary");

		await page.getByRole("button", { name: "Workspaces" }).click();
		await expect.element(page.getByTestId("session-search-workspace-ws-1")).toBeVisible();
		await expect.element(page.getByTestId("session-search-workspace-ws-2")).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Fix the bug/ })).not.toBeInTheDocument();

		await page.getByRole("button", { name: "Chats" }).click();
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
		const settle = card.getByRole("button", { name: "Settle thread" });
		await expect.element(settle).toBeVisible();

		const title = card.element().querySelector('[data-slot="aui_session-list-item-title"]');
		expect(title).not.toBeNull();
		const titleBox = title!.getBoundingClientRect();
		const settleBox = settle.element().getBoundingClientRect();
		expect(titleBox.right).toBeLessThanOrEqual(settleBox.left);
	});

	it("renders session cards and the settled shelf", async () => {
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
		expect(sessionTitle?.className).toContain("text-[13px]");
		await expect
			.element(screen.getByTestId("session-list-grouping-header"))
			.not.toBeInTheDocument();
		const inboxHeader = screen.getByTestId("session-list-inbox-header");
		await expect.element(inboxHeader).toBeVisible();
		await expect
			.element(screen.getByRole("combobox", { name: "Filter by workspace" }))
			.toBeVisible();
		await expect
			.element(inboxHeader.getByRole("button", { name: "Session list options" }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-active-toggle")).toBeVisible();
		const activeRow = screen.getByTestId("session-list-active-toggle").element().closest("li");
		expect(activeRow).not.toBeNull();
		expect(activeRow!.querySelector('[data-qa-id="session-list-view-menu"]')).not.toBeNull();
		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		const activeHeader = screen.getByTestId("session-list-active-toggle").element();
		const activeLabel = screen
			.getByTestId("session-list-active-toggle")
			.getByText("Active")
			.element();
		expect(activeLabel.className).toContain("text-[13px]");
		expect(activeLabel.className).toContain("font-medium");
		expect(activeLabel.className).toContain("text-muted-foreground/70");
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
		await expect.element(screen.getByText("Old work")).toBeVisible();
		const settledShelfRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await expect.element(settledShelfRow.getByText("2m")).not.toBeInTheDocument();
		// Workspace is opt-in via Show — default rows are title-only.
		await expect.element(screen.getByText("Acme App")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Updated" }).click();
		await expect.element(settledShelfRow.getByText("2m")).toBeVisible();
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
		await selected.getByRole("button", { name: /Add tests/ }).click();
		await userEvent.hover(idle);

		const selectedTitle = selected
			.element()
			.querySelector('[data-slot="aui_session-list-item-title"]');
		const idleTitle = idle.element().querySelector('[data-slot="aui_session-list-item-title"]');
		const selectedClasses = selectedTitle?.className.split(/\s+/) ?? [];
		const idleClasses = idleTitle?.className.split(/\s+/) ?? [];
		expect(selectedClasses).toContain("text-sidebar-foreground");
		expect(selectedClasses).not.toContain("text-sidebar-foreground/70");
		expect(selectedClasses).not.toContain("text-sidebar-accent-foreground");
		expect(idleClasses).toContain("group-hover/sidebar-row:text-sidebar-foreground");
		expect(idleClasses).not.toContain("group-hover/sidebar-row:text-sidebar-accent-foreground");
		const selectedRow = selected.element().querySelector('[data-slot="aui_session-list-item"]');
		const idleRow = idle.element().querySelector('[data-slot="aui_session-list-item"]');
		const selectedRowClasses = selectedRow?.className.split(/\s+/) ?? [];
		const idleRowClasses = idleRow?.className.split(/\s+/) ?? [];
		expect(selectedRowClasses).toContain("bg-muted");
		expect(selectedRowClasses).not.toContain("bg-foreground/8");
		expect(idleRowClasses).not.toContain("bg-muted");
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
		await expect.element(screen.getByRole("button", { name: /^Needs Attention$/ })).toBeVisible();
		await expect.element(screen.getByRole("status", { name: "Requires Approval" })).toBeVisible();
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
		await expect.element(screen.getByRole("status", { name: "Requires Input" })).toBeVisible();
	});

	it("settles a quiet session and un-settles it back", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(card).toBeVisible();
		await expect.element(screen.getByTestId("session-list-settled-toggle")).not.toBeInTheDocument();

		await userEvent.hover(card);
		await card.getByRole("button", { name: "Settle thread" }).click();

		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		expect(adapter.archiveCalls).toEqual(["ses-1"]);

		const settledRow = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await expect.element(settledRow).toBeVisible();
		await userEvent.hover(settledRow);
		await settledRow.getByRole("button", { name: "Un-settle thread" }).click();

		await expect.element(screen.getByTestId("session-list-settled-toggle")).not.toBeInTheDocument();
		expect(adapter.unarchiveCalls).toEqual(["ses-1"]);
		await expect
			.element(screen.getByRole("listitem").filter({ hasText: "Fix the bug" }))
			.toBeVisible();
	});

	it("keeps a settled session settled when viewing it", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		const settledRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await expect.element(settledRow).toBeVisible();

		await settledRow.getByRole("button", { name: /Old work/ }).click();

		expect(adapter.unarchiveCalls).toEqual([]);
		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		await expect
			.element(screen.getByRole("listitem").filter({ hasText: "Old work" }))
			.toBeVisible();
	});

	it("keeps grouped session titles aligned when a status icon is present", async () => {
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
		expect(Math.abs(iconBox.left - headerLeft)).toBeLessThan(2);
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

	it("shows a tooltip on the settled session icon", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Old work", status: "archived" }],
		});

		const icon = screen.getByRole("status", { name: "Settled" });
		await expect.element(icon).toBeVisible();
		await icon.hover();

		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Settled");
	});

	it("does not tint session icons with the workspace identity color", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Old work", status: "archived" },
				{ remoteId: "ses-2", title: "Unscoped work", status: "archived" },
			],
			hydrate: (store) => {
				store.getState().hydrateSessions([{ id: "ses-1", workspaceId: "ws-1" }]);
			},
		});

		const scoped = screen.getByRole("listitem").filter({ hasText: "Old work" });
		const unscoped = screen.getByRole("listitem").filter({ hasText: "Unscoped work" });
		const scopedIcon = scoped.getByRole("status", { name: "Settled" });
		const unscopedIcon = unscoped.getByRole("status", { name: "Settled" });
		await expect.element(scopedIcon).toBeVisible();
		await expect.element(unscopedIcon).toBeVisible();
		expect(scopedIcon.element().querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
		expect(unscopedIcon.element().querySelector("svg")?.getAttribute("stroke")).toBe(
			"currentColor",
		);
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
		const status = card.getByRole("status", { name: "Done" });
		const dot = card.getByTestId("session-list-done-dot");
		await expect.element(status).toBeVisible();
		await expect.element(dot).toBeVisible();
		expect(status.element().querySelector("svg")).toBeNull();
		expect(dot.element().className).toContain("bg-muted-foreground/40");
		expect(dot.element().style.backgroundColor).toBe("");
	});

	it("hides the settle action while a session is working", async () => {
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
			.element(card.getByRole("button", { name: "Settle thread" }))
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

		await expect.element(screen.getByText("Delete me")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Keep me")).toBeVisible();
		expect(adapter.deleteCalls).toEqual(["ses-2"]);
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
		expect(info.element().getBoundingClientRect().height).toBeGreaterThan(8);
		expect(card.element().getBoundingClientRect().height).toBeGreaterThan(36);
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
		await page.getByRole("menuitemradio", { name: "Updated" }).click();

		await expect
			.element(screen.getByTestId("session-list-grouping-header"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Today" })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Last 7 Days" })).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("3d")).toBeVisible();
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

		await expect
			.element(screen.getByTestId("session-list-grouping-header"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("session-list-attention-toggle"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-workspace-toggle")).toBeVisible();
		await expect.element(screen.getByText("Acme App")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
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
		const settle = card.getByRole("button", { name: "Settle thread" });
		await expect.element(pin).toBeVisible();
		await expect.element(more).toBeVisible();
		await expect.element(settle).toBeVisible();

		const pinBox = pin.element().getBoundingClientRect();
		const moreBox = more.element().getBoundingClientRect();
		const settleBox = settle.element().getBoundingClientRect();
		expect(pinBox.left).toBeGreaterThanOrEqual(settleBox.right);
		expect(moreBox.left).toBeGreaterThanOrEqual(pinBox.right);
		expect(moreBox.left - pinBox.right).toBeLessThan(4);

		const settleIcon = settle.element().querySelector("svg");
		const pinIcon = pin.element().querySelector("svg");
		expect(settleIcon).not.toBeNull();
		expect(pinIcon).not.toBeNull();
		expect(
			pinIcon!.getBoundingClientRect().left - settleIcon!.getBoundingClientRect().right,
		).toBeLessThan(10);
	});

	it("shows icon-only hover actions with tooltips", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		await userEvent.hover(card);

		const settle = card.getByRole("button", { name: "Settle thread" });
		await expect.element(settle).toBeVisible();
		expect(settle.element().textContent?.trim()).toBe("");

		await settle.hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Settle");

		await card.getByRole("button", { name: "Pin thread" }).hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Pin");

		await card.getByRole("button", { name: "Thread actions" }).hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("More");
	});

	it("shows a tooltip on the un-settle icon", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Old work", status: "archived" }],
		});

		const card = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await userEvent.hover(card);

		const unsettle = card.getByRole("button", { name: "Un-settle thread" });
		await expect.element(unsettle).toBeVisible();
		expect(unsettle.element().textContent?.trim()).toBe("");

		await unsettle.hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
			.toBe("Un-settle");
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
		await expect.element(screen.getByText("Old work")).toBeVisible();

		const pinnedCard = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const activeCard = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		const settledHeader = screen.getByTestId("session-list-settled-toggle").element();
		const afterPinned =
			activeHeader.getBoundingClientRect().top -
			pinnedCard.element().getBoundingClientRect().bottom;
		const betweenSections =
			settledHeader.getBoundingClientRect().top -
			activeCard.element().getBoundingClientRect().bottom;
		expect(Math.abs(afterPinned - betweenSections)).toBeLessThan(3);

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

	it("filters the list to settled sessions", async () => {
		const { screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Old work", status: "archived" },
			],
		});

		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await screen.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /^Status/ }).click();
		await page.getByRole("menuitemradio", { name: "Settled" }).click();

		await expect.element(screen.getByText("Old work")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-active-toggle")).not.toBeInTheDocument();
	});

	it("shows the workspace switcher at the top of the siderail", async () => {
		const { screen } = renderSessionList({
			threads: [{ remoteId: "ses-1", title: "Fix the bug" }],
		});

		const header = screen.getByTestId("session-list-inbox-header");
		await expect
			.element(header.getByRole("combobox", { name: "Filter by workspace" }))
			.toBeVisible();
		await expect
			.element(header.getByRole("combobox", { name: "Filter by workspace" }))
			.toHaveTextContent("All workspaces");
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		const headerEl = header.element();
		const trigger = header.getByRole("combobox", { name: "Filter by workspace" }).element();
		const filter = screen.getByRole("button", { name: "Session list options" }).element();
		const newChat = screen.getByRole("button", { name: "New Chat" }).element();
		const search = screen.getByRole("button", { name: "Search" }).element();
		const activeRow = screen.getByTestId("session-list-active-toggle").element().closest("li");
		expect(headerEl.contains(trigger)).toBe(true);
		expect(headerEl.contains(filter)).toBe(false);
		expect(activeRow?.contains(filter)).toBe(true);
		expect(headerEl.className).not.toContain("bg-foreground/5");
		expect(trigger.className).toContain("border-border/60");
		expect(trigger.className).toContain("bg-popover");
		expect(trigger.className).not.toContain("bg-background");
		expect(trigger.className).not.toContain("bg-input/30");
		expect(Number.parseFloat(getComputedStyle(trigger).borderTopWidth)).toBeGreaterThan(0);
		expect(headerEl.contains(newChat)).toBe(false);
		const switcherIcon = trigger.querySelector("svg");
		expect(switcherIcon?.classList.contains("lucide-layout-grid")).toBe(true);
		expect(switcherIcon?.getAttribute("stroke")).toBe("currentColor");
		await expect
			.element(screen.getByTestId("session-list-workspace-divider"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("session-list-chrome-divider")).not.toBeInTheDocument();
		const inbox = screen.getByTestId("session-list-inbox").element();
		expect(headerEl.compareDocumentPosition(newChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(newChat.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(search.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		const afterSwitcher =
			newChat.getBoundingClientRect().top - headerEl.getBoundingClientRect().bottom;
		const beforeInbox = inbox.getBoundingClientRect().top - search.getBoundingClientRect().bottom;
		expect(afterSwitcher).toBeGreaterThan(beforeInbox);
		expect(afterSwitcher - beforeInbox).toBeGreaterThanOrEqual(3);
		expect(getComputedStyle(trigger).fontSize).toBe(getComputedStyle(newChat).fontSize);
		expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
		expect(Number.parseFloat(getComputedStyle(trigger).paddingLeft)).toBe(8);
		expect(Number.parseFloat(getComputedStyle(trigger).paddingRight)).toBe(8);
		await expect
			.element(screen.getByRole("button", { name: "Session list options" }))
			.toBeVisible();

		await header.getByRole("combobox", { name: "Filter by workspace" }).click();
		await expect.element(page.getByRole("option", { name: "All workspaces" })).toBeVisible();
		const popover = document.querySelector('[data-slot="popover-content"]');
		expect(popover).not.toBeNull();
		expect(popover!.getBoundingClientRect().width).toBeCloseTo(
			trigger.getBoundingClientRect().width,
			0,
		);
		await expect.element(page.getByRole("option", { name: /Acme App/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Beta/ })).toBeVisible();
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

		await screen.getByRole("combobox", { name: "Filter by workspace" }).click();
		await page.getByRole("option", { name: /Acme App/ }).click();

		await expect
			.element(screen.getByRole("combobox", { name: "Filter by workspace" }))
			.toHaveTextContent("Acme App");
		const trigger = screen.getByRole("combobox", { name: "Filter by workspace" }).element();
		const switcherIcon = trigger.querySelector("svg");
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

		await screen.getByRole("combobox", { name: "Filter by workspace" }).click();
		await page.getByRole("option", { name: "All workspaces" }).click();
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		expect(setActiveWorkspaceId).toHaveBeenCalledTimes(1);
		const allIcon = screen
			.getByRole("combobox", { name: "Filter by workspace" })
			.element()
			.querySelector("svg");
		expect(allIcon?.classList.contains("lucide-layout-grid")).toBe(true);
		expect(allIcon?.getAttribute("stroke")).toBe("currentColor");
	});
});
