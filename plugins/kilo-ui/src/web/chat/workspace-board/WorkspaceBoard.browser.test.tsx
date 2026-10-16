import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { createStaticNavigation } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import type { WorkspaceBoardState } from "../../../contracts/workspace-board/board-model.js";
import { workspaceBoardContract } from "../../../contracts/workspace-board/schemas.js";
import { createEmptySessionActivity } from "../session-activity/session-activity-logic.js";
import { buildBoardSessions, resolveBoardColumns } from "./workspace-board-sessions.js";
import {
	WorkspaceBoardProvider,
	useWorkspaceBoard,
	type WorkspaceBoardContextValue,
} from "./WorkspaceBoardProvider.js";
import { WorkspaceBoardHeaderActions } from "./WorkspaceBoardHeaderActions.js";
import { WorkspaceBoardView } from "./WorkspaceBoardView.js";
import { useSessionRowBoard } from "./use-session-row-board.js";
import { WORKSPACE_BOARD_ROUTE_PATH } from "./workspace-board-constants.js";
import { createWorkspaceBoardBackend, workspaceBoardFlags } from "./test-helpers.js";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@kilo-desktop/ui/components/sonner", () => ({ toast: { error: toastError } }));

const sessions = buildBoardSessions({
	threadItems: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].map(
		(name) => ({
			id: `thread-${name}`,
			remoteId: `ses_${name}`,
			title: `Chat ${name}`,
			status: "regular",
		}),
	),
	activityBySessionId: { ses_one: { ...createEmptySessionActivity(), status: "busy" } },
	lastVisitedAtBySessionId: {},
});

function SidebarRow({ sessionId, title }: { sessionId: string; title: string }) {
	const board = useSessionRowBoard(sessionId, title);
	return (
		<li
			onPointerDown={board?.onDragPointerDown}
			data-qa-id={`sidebar-${sessionId}`}
			className="h-8 w-48 list-none border"
		>
			{title}
			<button type="button" data-qa-id={`sidebar-action-${sessionId}`}>
				Archive
			</button>
			{board?.placement ? (
				<span data-qa-id={`badge-${sessionId}`}>{board.placement.columnId}</span>
			) : null}
		</li>
	);
}

function Harness({ onOpen }: { onOpen: (sessionId: string) => void }) {
	const board = useWorkspaceBoard();
	if (!board) return <p data-qa-id="board-off">off</p>;
	return <HarnessBoard board={board} onOpen={onOpen} />;
}

function HarnessBoard({
	board,
	onOpen,
}: {
	board: WorkspaceBoardContextValue;
	onOpen: (sessionId: string) => void;
}) {
	return (
		<div className="flex gap-6 p-4">
			<ul className="flex shrink-0 flex-col gap-1">
				{[...sessions.values()].map((session) => (
					<SidebarRow key={session.sessionId} sessionId={session.sessionId} title={session.title} />
				))}
			</ul>
			<div className="h-[480px] min-w-0 flex-1">
				{/* The shell renders the route's header actions in the title bar. */}
				<WorkspaceBoardHeaderActions />
				<WorkspaceBoardView
					columns={resolveBoardColumns(board.board, sessions, null)}
					workspaces={[]}
					onDragStart={board.startDrag}
					onOpen={(session) => onOpen(session.sessionId)}
					columnToName={board.columnNaming.columnToName}
					onColumnNamingStarted={board.columnNaming.onNamingStarted}
					onRenameColumn={board.renameColumn}
					onMoveColumn={board.moveColumn}
					onDeleteColumn={board.deleteColumn}
				/>
			</div>
		</div>
	);
}

const THREE_COLUMNS: WorkspaceBoardState = {
	columns: [
		{ id: "backlog", label: "Backlog", sessionIds: [] },
		{ id: "in-progress", label: "In progress", sessionIds: [] },
		{ id: "done", label: "Done", sessionIds: [] },
	],
};

const backends: ReturnType<typeof createWorkspaceBoardBackend>[] = [];

function setup({
	initial = THREE_COLUMNS,
	path = WORKSPACE_BOARD_ROUTE_PATH,
	enabled = true,
	failWrites = false,
}: { initial?: WorkspaceBoardState; path?: string; enabled?: boolean; failWrites?: boolean } = {}) {
	const backend = createWorkspaceBoardBackend(initial);
	backends.push(backend);
	if (failWrites) backend.failWrites();
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspaceBoardContract,
		handlers: backend.handlers,
		featureFlags: workspaceBoardFlags(enabled),
		navigation: createStaticNavigation({ path, search: {} }),
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const onOpen = vi.fn();
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<SdkProvider system={system}>
				<WorkspaceBoardProvider>
					<Harness onOpen={onOpen} />
				</WorkspaceBoardProvider>
			</SdkProvider>
		</QueryClientProvider>,
	);
	return {
		screen: page.elementLocator(baseElement),
		place: backend.handlers["workspaceBoard.place"],
		onOpen,
		stored: backend.stored,
	};
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const center = (element: Element) => {
	const rect = element.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

/** Stepped pointer moves, as a real drag would produce. */
async function drag(
	source: Element,
	to: { x: number; y: number },
	beforeRelease?: () => void | Promise<void>,
	afterRelease?: () => void,
) {
	const from = center(source);
	const pointer = { pointerId: 1, isPrimary: true, button: 0 };
	fireEvent.pointerDown(source, { ...pointer, clientX: from.x, clientY: from.y });
	await nextFrame();
	const steps = 8;
	for (let step = 1; step <= steps; step += 1) {
		fireEvent.pointerMove(document, {
			...pointer,
			clientX: from.x + ((to.x - from.x) * step) / steps,
			clientY: from.y + ((to.y - from.y) * step) / steps,
		});
		await nextFrame();
	}
	await beforeRelease?.();
	fireEvent.pointerUp(document, { ...pointer, clientX: to.x, clientY: to.y });
	afterRelease?.();
	await nextFrame();
}

const cardTitles = (columnId: string) =>
	[
		...document.querySelectorAll(
			`[data-qa-id='workspace-board-column-${columnId}'] [data-qa-id='workspace-board-card-title']`,
		),
	].map((node) => node.textContent);

beforeEach(async () => {
	await page.viewport(1200, 700);
	await nextFrame();
});
afterEach(() => {
	cleanup();
	toastError.mockReset();
	for (const backend of backends.splice(0)) backend.dispose();
});

describe("workspace board drag and drop", () => {
	it("adds a chat dragged from the sidebar to the column it is dropped on", async () => {
		const { screen, place } = setup();
		const column = screen.getByTestId("workspace-board-column-in-progress").element();

		await drag(screen.getByTestId("sidebar-ses_two").element(), center(column));

		expect(place).toHaveBeenCalledExactlyOnceWith({
			sessionId: "ses_two",
			columnId: "in-progress",
			index: 0,
		});
		expect(cardTitles("in-progress")).toEqual(["Chat two"]);
		await expect.element(screen.getByTestId("badge-ses_two")).toHaveTextContent("in-progress");
		expect(document.querySelector("[data-qa-id='workspace-board-drag-preview']")).toBeNull();
	});

	it("moves a card to another column by dragging it", async () => {
		const { screen, place } = setup({
			initial: {
				columns: [
					{ id: "backlog", label: "Backlog", sessionIds: ["ses_one", "ses_two"] },
					{ id: "in-progress", label: "In progress", sessionIds: [] },
					{ id: "done", label: "Done", sessionIds: ["ses_three"] },
				],
			},
		});
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const target = screen.getByTestId("workspace-board-card-ses_three").element();
		const below = target.getBoundingClientRect();

		await drag(screen.getByTestId("workspace-board-card-ses_one").element(), {
			x: below.left + below.width / 2,
			y: below.bottom - 4,
		});

		expect(place).toHaveBeenCalledExactlyOnceWith({
			sessionId: "ses_one",
			columnId: "done",
			index: 1,
		});
		expect(cardTitles("backlog")).toEqual(["Chat two"]);
		expect(cardTitles("done")).toEqual(["Chat three", "Chat one"]);
	});

	it("reorders cards within a column", async () => {
		const { screen, place } = setup({
			initial: {
				columns: [
					{ id: "backlog", label: "Backlog", sessionIds: ["ses_one", "ses_two", "ses_three"] },
					{ id: "done", label: "Done", sessionIds: [] },
				],
			},
		});
		await expect.element(screen.getByTestId("workspace-board-card-ses_three")).toBeVisible();

		await drag(
			screen.getByTestId("workspace-board-card-ses_three").element(),
			center(screen.getByTestId("workspace-board-card-ses_one").element()),
		);

		expect(place).toHaveBeenCalledExactlyOnceWith({
			sessionId: "ses_three",
			columnId: "backlog",
			index: 0,
		});
		expect(cardTitles("backlog")).toEqual(["Chat three", "Chat one", "Chat two"]);
	});

	it("leaves the board unchanged when a chat is released outside every column", async () => {
		const { screen, place } = setup();
		const row = screen.getByTestId("sidebar-ses_one").element();
		const rect = row.getBoundingClientRect();

		await drag(row, { x: rect.left + 20, y: rect.bottom + 200 });

		expect(place).not.toHaveBeenCalled();
		expect(cardTitles("backlog")).toEqual([]);
	});

	it("previews the drop while dragging and cancels with Escape", async () => {
		const { screen, place } = setup();
		const column = screen.getByTestId("workspace-board-column-backlog").element();

		await drag(screen.getByTestId("sidebar-ses_one").element(), center(column), async () => {
			expect(document.querySelector("[data-qa-id='workspace-board-drag-preview']")).not.toBeNull();
			expect(column.querySelector("[data-qa-id='workspace-board-drop-preview']")).not.toBeNull();
			fireEvent.keyDown(window, { key: "Escape" });
		});

		expect(place).not.toHaveBeenCalled();
		expect(document.querySelector("[data-qa-id='workspace-board-drag-preview']")).toBeNull();
		expect(column.querySelector("[data-qa-id='workspace-board-drop-preview']")).toBeNull();
	});

	it("does not start a drag from a sidebar row's own buttons", async () => {
		const { screen, place } = setup();
		await drag(
			screen.getByTestId("sidebar-action-ses_one").element(),
			center(screen.getByTestId("workspace-board-column-backlog").element()),
		);
		expect(place).not.toHaveBeenCalled();
		expect(document.querySelector("[data-qa-id='workspace-board-drag-preview']")).toBeNull();
	});

	it("does not drag sidebar chats while the board is not on screen", async () => {
		const { screen, place } = setup({ path: "/plugins/chat" });
		await drag(
			screen.getByTestId("sidebar-ses_one").element(),
			center(screen.getByTestId("workspace-board-column-backlog").element()),
		);
		expect(place).not.toHaveBeenCalled();
	});

	it("exposes no board while the feature flag is off", async () => {
		const { screen } = setup({ enabled: false });
		await expect.element(screen.getByTestId("board-off")).toBeVisible();
	});
});

describe("workspace board cards", () => {
	const initial: WorkspaceBoardState = {
		columns: [
			{ id: "backlog", label: "Backlog", sessionIds: ["ses_one", "ses_two"] },
			{ id: "done", label: "Done", sessionIds: [] },
		],
	};

	it("opens the chat when a card is clicked", async () => {
		const { screen, onOpen } = setup({ initial });
		await screen.getByRole("button", { name: "Open Chat two" }).click();
		expect(onOpen).toHaveBeenCalledExactlyOnceWith("ses_two");
	});

	it("shows a status on every card: the live state, otherwise Idle", async () => {
		const { screen } = setup({ initial });
		await expect
			.element(
				screen
					.getByTestId("workspace-board-card-ses_one")
					.getByTestId("workspace-board-card-status"),
			)
			.toHaveTextContent("Working");
		await expect
			.element(
				screen
					.getByTestId("workspace-board-card-ses_two")
					.getByTestId("workspace-board-card-status"),
			)
			.toHaveTextContent("Idle");
	});

	it("counts the cards in each column", async () => {
		const { screen } = setup({ initial });
		await expect
			.element(screen.getByTestId("workspace-board-column-count-backlog"))
			.toHaveTextContent("2");
		await expect
			.element(screen.getByTestId("workspace-board-column-count-done"))
			.toHaveTextContent("0");
	});

	it("restores the board and reports the failure when a change cannot be saved", async () => {
		const { screen } = setup({ initial, failWrites: true });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();

		await drag(
			screen.getByTestId("workspace-board-card-ses_one").element(),
			center(screen.getByTestId("workspace-board-column-done").element()),
		);

		await vi.waitFor(() => expect(toastError).toHaveBeenCalledOnce());
		expect(toastError.mock.calls[0]![0]).toBe("Could not update the board");
		await vi.waitFor(() => expect(cardTitles("backlog")).toEqual(["Chat one", "Chat two"]));
		expect(cardTitles("done")).toEqual([]);
	});
});

describe("workspace board columns", () => {
	const initial: WorkspaceBoardState = {
		columns: [
			{ id: "backlog", label: "Backlog", sessionIds: ["ses_one"] },
			{ id: "review", label: "Review", sessionIds: ["ses_two", "ses_three"] },
			{ id: "done", label: "Done", sessionIds: [] },
		],
	};

	const columnLabels = () =>
		[...document.querySelectorAll("[data-workspace-board-column] h2")].map(
			(node) => node.textContent,
		);

	/** The default board shares column ids with `initial`, so wait for the seeded board. */
	async function setupSeeded() {
		const result = setup({ initial });
		await expect.element(result.screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		return result;
	}

	async function openColumnMenu(screen: ReturnType<typeof setup>["screen"], columnId: string) {
		await screen.getByTestId(`workspace-board-column-header-${columnId}`).hover();
		await screen.getByTestId(`workspace-board-column-menu-${columnId}`).click();
	}

	const lastColumnMenu = () =>
		[...document.querySelectorAll("[data-qa-id^='workspace-board-column-menu-']")].at(-1);

	it("adds a column from the title bar and opens its name for editing", async () => {
		const { screen, stored } = await setupSeeded();
		await screen.getByRole("button", { name: "Add column" }).click();

		const name = screen.getByTestId("workspace-board-column-rename");
		await expect.element(name).toHaveFocus();
		await expect.element(name).toHaveValue("New column");
		await name.fill("Blocked");
		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() =>
			expect(columnLabels()).toEqual(["Backlog", "Review", "Done", "Blocked"]),
		);
		await vi.waitFor(() => expect(stored().columns.at(-1)?.label).toBe("Blocked"));
		await vi.waitFor(() => expect(document.activeElement).toBe(lastColumnMenu()));
	});

	it("keeps the default name when naming a new column is cancelled", async () => {
		const { screen, stored } = await setupSeeded();
		await screen.getByRole("button", { name: "Add column" }).click();
		await expect.element(screen.getByTestId("workspace-board-column-rename")).toHaveFocus();
		await userEvent.keyboard("{Escape}");

		await vi.waitFor(() =>
			expect(columnLabels()).toEqual(["Backlog", "Review", "Done", "New column"]),
		);
		await vi.waitFor(() => expect(stored().columns.at(-1)?.label).toBe("New column"));
		await vi.waitFor(() => expect(document.activeElement).toBe(lastColumnMenu()));
	});

	it("disables adding columns once the board holds the most it may", async () => {
		const full: WorkspaceBoardState = {
			columns: Array.from({ length: 20 }, (_, index) => ({
				id: `c${index}`,
				label: `Column ${index}`,
				sessionIds: index === 0 ? ["ses_one"] : [],
			})),
		};
		const { screen } = setup({ initial: full });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const add = screen.getByRole("button", { name: "Add column" });
		await expect.element(add).toBeDisabled();
		await expect
			.element(add)
			.toHaveAttribute("aria-description", "A board can have at most 20 columns");
	});

	it("renames a column from its menu", async () => {
		const { screen, stored } = await setupSeeded();
		await openColumnMenu(screen, "review");
		await screen.getByTestId("workspace-board-column-rename-action").click();
		await screen.getByTestId("workspace-board-column-rename").fill("In review");
		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() => expect(columnLabels()).toEqual(["Backlog", "In review", "Done"]));
		await vi.waitFor(() => expect(stored().columns[1]?.label).toBe("In review"));
		await expect.element(screen.getByTestId("workspace-board-column-menu-review")).toHaveFocus();
	});

	it("keeps the name when a rename is cancelled", async () => {
		const { screen } = await setupSeeded();
		await openColumnMenu(screen, "review");
		await screen.getByTestId("workspace-board-column-rename-action").click();
		await screen.getByTestId("workspace-board-column-rename").fill("Something else");
		await userEvent.keyboard("{Escape}");

		await expect.element(screen.getByTestId("workspace-board-column-menu-review")).toBeVisible();
		expect(columnLabels()).toEqual(["Backlog", "Review", "Done"]);
	});

	it("deletes an empty column without asking", async () => {
		const { screen } = await setupSeeded();
		await openColumnMenu(screen, "done");
		await screen.getByTestId("workspace-board-column-delete-action").click();

		await vi.waitFor(() => expect(columnLabels()).toEqual(["Backlog", "Review"]));
	});

	it("confirms before deleting a column with chats and moves them to its neighbour", async () => {
		const { screen } = await setupSeeded();
		await openColumnMenu(screen, "review");
		await screen.getByTestId("workspace-board-column-delete-action").click();
		const dialog = screen.getByTestId("workspace-board-column-delete-dialog");
		await expect.element(dialog).toBeVisible();
		expect(dialog.element().textContent).toContain("This moves its 2 chats to “Done”");
		await screen.getByTestId("workspace-board-column-delete-confirm").click();

		await vi.waitFor(() => expect(columnLabels()).toEqual(["Backlog", "Done"]));
		expect(cardTitles("done")).toEqual(["Chat two", "Chat three"]);
	});

	it("reorders a column by dragging its header", async () => {
		const { screen, stored } = await setupSeeded();
		const header = screen.getByTestId("workspace-board-column-header-backlog").element();
		const review = screen
			.getByTestId("workspace-board-column-review")
			.element()
			.getBoundingClientRect();

		await drag(header, { x: review.right + 4, y: review.top + 20 }, () => {
			const ghost = document.querySelector("[data-qa-id='workspace-board-drag-preview']");
			expect(ghost?.textContent).toBe("Backlog1 chat");
			expect(
				document.querySelector("[data-qa-id='workspace-board-column-drop-preview']"),
			).not.toBeNull();
		});

		expect(columnLabels()).toEqual(["Review", "Backlog", "Done"]);
		await vi.waitFor(() =>
			expect(stored().columns.map((column) => column.id)).toEqual(["review", "backlog", "done"]),
		);
		expect(cardTitles("backlog")).toEqual(["Chat one"]);
		expect(document.querySelector("[data-qa-id='workspace-board-column-drop-preview']")).toBeNull();
	});

	it("holds the drop preview until the new column order has rendered, so nothing flickers", async () => {
		const { screen } = await setupSeeded();
		const header = screen.getByTestId("workspace-board-column-header-backlog").element();
		const review = screen
			.getByTestId("workspace-board-column-review")
			.element()
			.getBoundingClientRect();
		const preview = () =>
			document.querySelector("[data-qa-id='workspace-board-column-drop-preview']");

		await drag(header, { x: review.right + 4, y: review.top + 20 }, undefined, () => {
			// The store update has not rendered yet: the preview still stands in for the column.
			expect(preview()).not.toBeNull();
			expect(columnLabels()).toEqual(["Backlog", "Review", "Done"]);
			expect(
				screen.getByTestId("workspace-board-column-backlog").element().dataset.boardReordering,
			).toBe("true");
		});

		await vi.waitFor(() => expect(columnLabels()).toEqual(["Review", "Backlog", "Done"]));
		expect(preview()).toBeNull();
		expect(document.querySelector("[data-board-reordering]")).toBeNull();
	});

	it("leaves the column order unchanged when a column drag is released off the board", async () => {
		const { screen } = await setupSeeded();
		const header = screen.getByTestId("workspace-board-column-header-backlog").element();
		const sidebar = screen.getByTestId("sidebar-ses_one").element().getBoundingClientRect();

		await drag(header, { x: sidebar.left + 10, y: sidebar.top + 10 });

		expect(columnLabels()).toEqual(["Backlog", "Review", "Done"]);
	});

	it("moves columns left and right from the column menu", async () => {
		const { screen } = await setupSeeded();
		await openColumnMenu(screen, "backlog");
		await expect
			.element(screen.getByTestId("workspace-board-column-move-left"))
			.toHaveAttribute("aria-disabled", "true");
		await screen.getByTestId("workspace-board-column-move-right").click();
		await vi.waitFor(() => expect(columnLabels()).toEqual(["Review", "Backlog", "Done"]));

		await openColumnMenu(screen, "done");
		await expect
			.element(screen.getByTestId("workspace-board-column-move-right"))
			.toHaveAttribute("aria-disabled", "true");
		await screen.getByTestId("workspace-board-column-move-left").click();
		await vi.waitFor(() => expect(columnLabels()).toEqual(["Review", "Done", "Backlog"]));
	});

	it("shows a column's menu button only while the column, not one of its cards, is hovered", async () => {
		const { screen } = await setupSeeded();
		const button = screen.getByTestId("workspace-board-column-menu-review");
		await expect.element(button).toHaveStyle({ opacity: "0" });

		await screen.getByTestId("workspace-board-column-header-review").hover();
		await expect.element(button).toHaveStyle({ opacity: "1" });

		await screen.getByTestId("workspace-board-card-ses_two").hover();
		await expect.element(button).toHaveStyle({ opacity: "0" });
	});

	it("does not offer to delete the only column", async () => {
		const { screen } = setup({
			initial: { columns: [{ id: "only", label: "Only", sessionIds: [] }] },
		});
		await expect.element(screen.getByTestId("workspace-board-column-only")).toBeVisible();
		await openColumnMenu(screen, "only");
		await expect
			.element(screen.getByTestId("workspace-board-column-delete-action"))
			.toHaveAttribute("aria-disabled", "true");
	});
});

describe("workspace board layout", () => {
	const initial: WorkspaceBoardState = {
		columns: [
			{ id: "backlog", label: "Backlog", sessionIds: ["ses_one"] },
			{ id: "review", label: "Review", sessionIds: ["ses_two"] },
			{ id: "done", label: "Done", sessionIds: [] },
		],
	};

	const columnRects = () =>
		[...document.querySelectorAll("[data-workspace-board-column]")].map((column) =>
			column.getBoundingClientRect(),
		);

	it("sizes each column to its cards, as in Trello", async () => {
		const { screen } = setup({
			initial: {
				columns: [
					{ id: "backlog", label: "Backlog", sessionIds: ["ses_one", "ses_two", "ses_three"] },
					{ id: "done", label: "Done", sessionIds: [] },
				],
			},
		});
		await expect.element(screen.getByTestId("workspace-board-card-ses_three")).toBeVisible();
		const [backlog, done] = columnRects();
		expect(done!.height).toBeLessThan(backlog!.height);
		const strip = document.querySelector("[data-workspace-board-columns]")!.getBoundingClientRect();
		expect(backlog!.bottom).toBeLessThan(strip.bottom);
	});

	it("stops a long column at the board's height and scrolls its cards", async () => {
		const many = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
		const { screen } = setup({
			initial: {
				columns: [{ id: "backlog", label: "Backlog", sessionIds: many.map((n) => `ses_${n}`) }],
			},
		});
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const column = screen.getByTestId("workspace-board-column-backlog").element();
		const strip = document.querySelector<HTMLElement>("[data-workspace-board-columns]")!;
		const contentBottom =
			strip.getBoundingClientRect().bottom -
			Number.parseFloat(getComputedStyle(strip).paddingBottom);
		expect(Math.abs(column.getBoundingClientRect().bottom - contentBottom)).toBeLessThanOrEqual(1);
		expect(strip.scrollHeight).toBeLessThanOrEqual(strip.clientHeight);
		const cards = column.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']")!;
		expect(cards.scrollHeight).toBeGreaterThan(cards.clientHeight);
	});

	it("drops a chat into the empty space below a short column", async () => {
		const { screen, place } = setup({ initial });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const done = screen
			.getByTestId("workspace-board-column-done")
			.element()
			.getBoundingClientRect();

		await drag(screen.getByTestId("workspace-board-card-ses_one").element(), {
			x: done.left + done.width / 2,
			y: done.bottom + 40,
		});

		expect(place).toHaveBeenCalledExactlyOnceWith({
			sessionId: "ses_one",
			columnId: "done",
			index: 0,
		});
	});

	it("ignores a release over the sidebar while the board is scrolled sideways", async () => {
		await page.viewport(700, 700);
		const { screen, place } = setup({ initial });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const strip = document.querySelector<HTMLElement>("[data-workspace-board-columns]")!;
		strip.scrollLeft = strip.scrollWidth;
		await nextFrame();
		const sidebar = screen.getByTestId("sidebar-ses_two").element().getBoundingClientRect();
		const stripRect = strip.getBoundingClientRect();

		await drag(screen.getByTestId("sidebar-ses_two").element(), {
			x: sidebar.left + 10,
			y: stripRect.top + stripRect.height / 2,
		});

		expect(place).not.toHaveBeenCalled();
	});

	it("scrolls the board sideways while dragging near its edge", async () => {
		await page.viewport(700, 700);
		const { screen } = setup({ initial });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const strip = document.querySelector<HTMLElement>("[data-workspace-board-columns]")!;
		const rect = strip.getBoundingClientRect();

		await drag(
			screen.getByTestId("workspace-board-card-ses_one").element(),
			{ x: rect.right - 8, y: rect.top + 60 },
			async () => {
				await vi.waitFor(() => expect(strip.scrollLeft).toBeGreaterThan(0));
			},
		);
	});

	it("keeps every column on one row and scrolls sideways when they do not fit", async () => {
		await page.viewport(700, 700);
		const { screen } = setup({ initial });
		await expect.element(screen.getByTestId("workspace-board-card-ses_one")).toBeVisible();
		const rects = columnRects();
		expect(new Set(rects.map((rect) => rect.width)).size).toBe(1);
		expect(new Set(rects.map((rect) => rect.top)).size).toBe(1);
		const strip = document.querySelector<HTMLElement>("[data-workspace-board-columns]")!;
		expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
	});
});
