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
			folders: [{ id: "folder-1", path: "/repo/acme", isPrimary: true, position: 0 }],
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
}: {
	adapter: SeededThreadListAdapter;
	store: ReturnType<typeof createSessionActivityStore>;
	system: ReturnType<typeof createFakeFeatureSystem>;
}) {
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook: () => useLocalRuntime(stubChatModel),
	});

	return (
		<SdkProvider system={system}>
			<AssistantRuntimeProvider runtime={runtime}>
				<SessionActivityProvider store={store}>
					<WorkspacesContext.Provider value={workspacesValue}>
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
}: {
	threads: SeededThread[];
	hydrate?: (store: ReturnType<typeof createSessionActivityStore>) => void;
}) {
	const adapter = new SeededThreadListAdapter(threads);
	const navigate = vi.fn();
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
	const result = render(<SessionListHarness adapter={adapter} store={store} system={system} />);
	return { adapter, navigate, store, screen: page.elementLocator(result.baseElement), ...result };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("SessionList", () => {
	it("keeps the new-chat selectors and behavior", async () => {
		const { baseElement, navigate, screen } = renderSessionList({ threads: [] });

		await expect.element(page.getByTestId("kilo-thread-list")).toBeVisible();
		const newChat = screen.getByRole("button", { name: "New Chat" });
		await expect.element(newChat).toBeVisible();
		// The e2e page object locates the button by this data-slot.
		expect(baseElement.querySelector('[data-slot="aui_thread-list-new"]')).not.toBeNull();
		expect(baseElement.querySelector('[data-slot="aui_thread-list-items"]')?.className).toContain(
			"scroll-fade",
		);

		await newChat.click();
		await expect.element(newChat).toHaveAttribute("aria-current", "true");
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenLastCalledWith("/plugins/chat", undefined);

		await newChat.click();
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it("keeps original thread indices when filtering by title", async () => {
		const { adapter, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Fix the bug" },
				{ remoteId: "ses-2", title: "Add tests" },
			],
		});

		await screen.getByRole("searchbox", { name: "Search chats" }).fill("Add tests");

		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("Fix the bug")).not.toBeInTheDocument();
		const card = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		await userEvent.hover(card);
		await card.getByRole("button", { name: "Settle thread" }).click();
		expect(adapter.archiveCalls).toEqual(["ses-2"]);
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
		const grouping = screen.getByTestId("session-list-grouping-header");
		await expect.element(grouping).toBeVisible();
		await expect.element(grouping.getByText("Status")).toBeVisible();
		await expect
			.element(grouping.getByRole("button", { name: "Session list options" }))
			.toBeVisible();
		await expect.element(screen.getByTestId("session-list-active-toggle")).toBeVisible();
		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		const groupingLabel = grouping.getByText("Status").element();
		expect(groupingLabel.className).toContain("text-sm");
		expect(groupingLabel.className).toContain("font-medium");
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

		await grouping.getByRole("button", { name: "Session list options" }).click();
		await page.getByRole("menuitem", { name: /Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "Updated" }).click();
		await expect.element(settledShelfRow.getByText("2m")).toBeVisible();
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
			.toBe("Working · 0s");
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
			.element(screen.getByTestId("session-list-grouping-header").getByText("Updated"))
			.toBeVisible();
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
			.element(screen.getByTestId("session-list-grouping-header").getByText("Workspaces"))
			.toBeVisible();
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
		const groupingHeader = screen.getByTestId("session-list-grouping-header").element();
		expect(
			pinnedHeader.compareDocumentPosition(groupingHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		await expect.element(screen.getByText("Fix the bug")).toBeVisible();
		await expect.element(screen.getByText("Add tests")).toBeVisible();
		await expect.element(screen.getByText("Old work")).toBeVisible();

		const pinnedCard = screen.getByRole("listitem").filter({ hasText: "Fix the bug" });
		const activeCard = screen.getByRole("listitem").filter({ hasText: "Add tests" });
		const settledHeader = screen.getByTestId("session-list-settled-toggle").element();
		const afterPinned =
			groupingHeader.getBoundingClientRect().top -
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
});
