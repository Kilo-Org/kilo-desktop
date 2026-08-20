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
		await expect.element(screen.getByTestId("session-list-active-toggle")).toBeVisible();
		await expect.element(screen.getByTestId("session-list-settled-toggle")).toBeVisible();
		await expect.element(screen.getByText("Old work")).toBeVisible();
		// Settled rows show the session's last-updated time.
		const settledShelfRow = screen.getByRole("listitem").filter({ hasText: "Old work" });
		await expect.element(settledShelfRow.getByText("2m")).toBeVisible();
		// Workspace name resolves from the stamped workspace id, not the directory.
		await expect.element(screen.getByText("Acme App")).toBeVisible();
	});

	it("renders active and settled titles at the 14px chat-text size", async () => {
		const { baseElement, screen } = renderSessionList({
			threads: [
				{ remoteId: "ses-1", title: "Active work" },
				{ remoteId: "ses-2", title: "Settled work", status: "archived" },
			],
		});

		await expect.element(screen.getByText("Active work")).toBeVisible();
		await expect.element(screen.getByText("Settled work")).toBeVisible();
		const titles = baseElement.querySelectorAll<HTMLElement>(
			'[data-slot="aui_session-list-item-title"]',
		);

		expect([...titles].map((title) => getComputedStyle(title).fontSize)).toEqual(["14px", "14px"]);
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
		await expect.element(screen.getByText("Requires Approval")).toBeVisible();
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
		await expect.element(screen.getByText("Requires Input")).toBeVisible();
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
		await expect.element(screen.getByText("Working")).toBeVisible();

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
		const renameInput = document.querySelector<HTMLElement>(
			'[data-slot="aui_session-list-item-rename"]',
		);
		if (!renameInput) throw new Error("Expected the rename input to render.");
		expect(getComputedStyle(renameInput).fontSize).toBe("14px");
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
});
