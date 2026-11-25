import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry, PluginSdk } from "@kilo-desktop/kernel";
import { NOW, renderWorkSessions, workSession, workspace } from "../../testing";
import {
	type WorkSession,
	WorkSessionListAction,
	WorkSessionAction,
	WorkSessionFacet,
	WorkSessionGrouping,
	type WorkSessionGroup,
	type WorkSessionActionProps,
	type WorkSessionPullRequestState,
	WorkSessionDecoration,
	WorkSessionMenu,
	type WorkSessionDecorationProps,
} from "../../contracts";

/** A plugin that adds to the session menu, decorations and the header and list actions. */
function contributorPlugin() {
	const shared = vi.fn<(session: WorkSession) => void>();
	const pushed = vi.fn<(session: WorkSession) => void>();
	return {
		shared,
		pushed,
		plugin: {
			manifest: {
				manifestVersion: 1,
				id: "test.contributor",
				displayName: "Contributor",
				version: "1.0.0",
				contributes: {
					extensions: {
						"kilo.work-sessions/work-session-menu": [
							{ id: "share", title: "Share" },
							{ id: "discard", title: "Discard worktree", destructive: true },
						],
						"kilo.work-sessions/work-session-decoration": [
							{ id: "row-badge", slot: "row" },
							{ id: "live-status", slot: "status" },
							{ id: "branch-detail", slot: "hover-branch" },
							{ id: "pr-detail", slot: "hover" },
						],
						"kilo.work-sessions/work-session-action": [
							{ id: "push" },
							{ id: "commit", placement: "start" },
						],
						"kilo.work-sessions/work-session-list-action": [{ id: "board" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(WorkSessionMenu, "share", { run: shared });
					sdk.extensions.implement(WorkSessionMenu, "discard", {
						run: () => undefined,
						appliesTo: (s) => s.branch !== null,
					});
					sdk.extensions.implement(
						WorkSessionDecoration,
						"row-badge",
						({ workSession: s }: WorkSessionDecorationProps) => (
							<span data-qa-id={`row-badge-${s.id}`}>PR</span>
						),
					);
					sdk.extensions.implement(
						WorkSessionDecoration,
						"live-status",
						({ workSession: s }: WorkSessionDecorationProps) => (
							<span data-qa-id={`live-status-${s.id}`}>live</span>
						),
					);
					sdk.extensions.implement(
						WorkSessionDecoration,
						"branch-detail",
						({ workSession: s }: WorkSessionDecorationProps) => (
							<span data-qa-id="branch-detail">live branch of {s.id}</span>
						),
					);
					sdk.extensions.implement(
						WorkSessionDecoration,
						"pr-detail",
						({ workSession: s }: WorkSessionDecorationProps) => (
							<span data-qa-id="pr-detail">PR of {s.id}</span>
						),
					);
					sdk.extensions.implement(WorkSessionAction, "commit", () => (
						<button type="button">Commit</button>
					));
					sdk.extensions.implement(
						WorkSessionAction,
						"push",
						({ workSession: s }: WorkSessionActionProps) => (
							<button type="button" onClick={() => pushed(s)}>
								Push
							</button>
						),
					);
					sdk.extensions.implement(WorkSessionListAction, "board", () => (
						<button type="button">Board</button>
					));
				},
			} satisfies PluginEntry,
		},
	};
}

const list = () => page.getByTestId("kilo-thread-list");
const row = (title: string) =>
	list()
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });
const titles = () =>
	list()
		.getByTestId("session-list-item-title")
		.elements()
		.map((element) => element.textContent);
const openRowMenu = async (title: string) => {
	await row(title).hover();
	await row(title).getByTestId("session-list-item-more").click();
};

describe("session list", () => {
	it("groups pinned and active sessions, keeping archived ones collapsed at the end", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Fix login" }),
				workSession("b", { title: "Pinned work", pinned: true }),
				workSession("c", { title: "Old idea", archived: true }),
			],
		});

		await expect.element(list().getByTestId("session-list-pinned-toggle")).toBeVisible();
		await expect.element(row("Pinned work")).toBeVisible();
		await expect.element(row("Fix login")).toBeVisible();
		await expect.element(row("Old idea")).not.toBeInTheDocument();

		await list().getByTestId("session-list-archived-toggle").click();
		await expect.element(row("Old idea")).toBeVisible();
	});

	it("opens a session: the row is current and the header names its workspace and title", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App")],
		});

		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("a"));
		await expect.element(row("Fix login")).toHaveAttribute("data-active", "true");
		const breadcrumb = page.getByTestId("session-breadcrumb");
		await expect.element(breadcrumb.getByText("App")).toBeVisible();
		await expect.element(breadcrumb.getByText("Fix login")).toBeVisible();
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
	});

	it("pins from the row menu, and the session moves to Pinned", async () => {
		const { workSessions } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledWith("a", true));
		await expect.element(list().getByTestId("session-list-pinned-toggle")).toBeVisible();
	});

	it("archives and restores a session", async () => {
		const { workSessions } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-archive").click();
		await vi.waitFor(() => expect(workSessions.calls.setArchived).toHaveBeenCalledWith("a", true));

		await list().getByTestId("session-list-archived-toggle").click();
		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-restore").click();
		await vi.waitFor(() => expect(workSessions.calls.setArchived).toHaveBeenCalledWith("a", false));
	});

	it("renames inline from the menu, and keeps editing with the reason when it fails", async () => {
		const { workSessions } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-rename").click();
		workSessions.failNextWith("Title is taken.");
		await page.getByTestId("session-list-item-rename").fill("Fix sign-in");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByText("Title is taken.")).toBeVisible();

		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() =>
			expect(workSessions.calls.rename).toHaveBeenLastCalledWith("a", "Fix sign-in"),
		);
		await expect.element(row("Fix sign-in")).toBeVisible();
	});

	it("deletes only after confirmation, and closes the session if it was open", async () => {
		const { workSessions, window } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-cancel").click();
		expect(workSessions.calls.remove).not.toHaveBeenCalled();

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-confirm").click();

		await vi.waitFor(() => expect(workSessions.calls.remove).toHaveBeenCalledWith("a"));
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBeNull());
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
	});

	it("groups by workspace, filters to one, and starts a session in a workspace from its shelf", async () => {
		const { workspaces, window } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "App work", workspaceId: "w-app" }),
				workSession("b", { title: "Docs work", workspaceId: "w-docs" }),
			],
			workspaces: [
				workspace("w-app", "App"),
				workspace("w-docs", "Docs"),
				workspace("w-new", "New"),
			],
		});

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: /^Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Workspace" }).click();
		await userEvent.keyboard("{Escape}{Escape}");
		await expect.element(list().getByTestId("session-list-workspace-empty-w-new")).toBeVisible();

		await list().getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /Docs/ }).click();
		await vi.waitFor(() => expect(window().getState().focus).toBe("w-docs"));
		await expect.element(row("Docs work")).toBeVisible();
		await expect.element(row("App work")).not.toBeInTheDocument();
		expect(workspaces.setActive).toHaveBeenCalledWith("w-docs");

		await list().getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /All workspaces/ }).click();
		await list().getByTestId("session-list-workspace-new-w-app").click({ force: true });
		await vi.waitFor(() => expect(workspaces.setActive).toHaveBeenLastCalledWith("w-app"));
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
	});

	it("edits, deletes and adds workspaces through the workspace commands", async () => {
		await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			localStorage: {
				"kilo-ui.session-list-view:v1": JSON.stringify({ grouping: "workspace" }),
			},
		});

		await list().getByTestId("session-list-workspace-actions-w-app").click({ force: true });
		await page.getByRole("menuitem", { name: "Edit" }).click();
		await expect
			.element(
				page.getByTestId("workspace-form-dialog").getByRole("heading", { name: "Edit workspace" }),
			)
			.toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();

		await list().getByTestId("session-list-workspace-actions-w-app").click({ force: true });
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await expect.element(page.getByRole("heading", { name: "Delete App?" })).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();

		await list().getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /New workspace/ }).click();
		await expect
			.element(
				page
					.getByTestId("workspace-form-dialog")
					.getByRole("heading", { name: "Create workspace" }),
			)
			.toBeVisible();
	});

	it("explains an empty focused list", async () => {
		await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			localStorage: {
				"kilo.work-sessions.window:main": JSON.stringify({
					focus: "w-app",
					activeWorkSessionId: null,
				}),
			},
		});

		await expect.element(page.getByText("No sessions in App")).toBeVisible();
	});
});

describe("multi-selection", () => {
	const trigger = (title: string) => row(title).getByTestId("session-list-item-trigger");
	// A row's hover card opens 600ms into a hover and, flipped below the row in
	// the narrow test viewport, covers the next one; leaving the row after each
	// click keeps a slow run from clicking into the card.
	const clickRow = async (
		title: string,
		options?: Parameters<ReturnType<typeof trigger>["click"]>[0],
	) => {
		await trigger(title).click(options);
		await userEvent.unhover(trigger(title));
	};
	const selected = () =>
		[...document.querySelectorAll('[data-selected] [data-qa-id="session-list-item-title"]')]
			.map((node) => node.textContent)
			.sort();
	const three = () => [
		workSession("a", { title: "First", updatedAt: NOW - 1_000 }),
		workSession("b", { title: "Second", updatedAt: NOW - 2_000 }),
		workSession("c", { title: "Third", updatedAt: NOW - 3_000 }),
	];
	const selectAll = async () => {
		for (const title of ["First", "Second", "Third"]) {
			await clickRow(title, { modifiers: ["Meta"] });
		}
		await expect.poll(selected).toEqual(["First", "Second", "Third"]);
	};

	it("selects with Meta- and Shift-click without opening, and clears on Escape or a plain click", async () => {
		const { window } = await renderWorkSessions({ workSessions: three() });

		await clickRow("First", { modifiers: ["Meta"] });
		await clickRow("Third", { modifiers: ["Shift"] });
		await expect.poll(selected).toEqual(["First", "Second", "Third"]);
		await clickRow("Second", { modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["First", "Third"]);
		await expect
			.element(page.getByTestId("session-list-selection-hint"))
			.toHaveTextContent("2 selected · Esc to clear");
		expect(window().getState().activeWorkSessionId).toBeNull();

		await userEvent.keyboard("{Escape}");
		await expect.poll(selected).toEqual([]);
		await expect.element(page.getByTestId("session-list-selection-hint")).not.toBeInTheDocument();

		await clickRow("First", { modifiers: ["Meta"] });
		await clickRow("Second");
		await expect.poll(selected).toEqual([]);
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("b"));
	});

	it("adds the open session to the first Meta-click", async () => {
		await renderWorkSessions({ workSessions: three() });

		await clickRow("First");
		await clickRow("Third", { modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["First", "Third"]);
	});

	it("archives and pins a selection from the right-click menu", async () => {
		const { workSessions } = await renderWorkSessions({ workSessions: three() });
		await selectAll();

		await row("Second").click({ button: "right" });
		await expect.element(page.getByText("3 sessions selected")).toBeVisible();
		await page.getByTestId("session-bulk-pin").click();
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledTimes(3));
		await expect.poll(selected).toEqual([]);

		await selectAll();
		await row("First").click({ button: "right" });
		await page.getByTestId("session-bulk-archive").click();
		await vi.waitFor(() => expect(workSessions.calls.setArchived).toHaveBeenCalledTimes(3));
	});

	it("right-clicking one session shows its own menu and clears a selection it isn't in", async () => {
		const { workSessions } = await renderWorkSessions({ workSessions: three() });
		await clickRow("First", { modifiers: ["Meta"] });
		await clickRow("Second", { modifiers: ["Meta"] });

		await row("Third").click({ button: "right" });
		await expect.poll(selected).toEqual([]);
		await expect.element(page.getByText(/sessions selected/)).not.toBeInTheDocument();
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledWith("c", true));
	});

	it("selects from the keyboard: arrows move, Shift+arrows grow and shrink, Cmd+A selects all", async () => {
		const { window } = await renderWorkSessions({ workSessions: three() });
		await expect.element(trigger("First")).toBeVisible();
		(trigger("First").element() as HTMLElement).focus();

		await userEvent.keyboard("{ArrowDown}");
		await expect.element(trigger("Second")).toHaveFocus();
		expect(selected()).toEqual([]);

		await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
		await expect.poll(selected).toEqual(["Second", "Third"]);
		await expect.element(trigger("Third")).toHaveFocus();
		await userEvent.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
		await expect.poll(selected).toEqual(["First", "Second"]);

		await userEvent.keyboard("{Meta>}a{/Meta}");
		await expect.poll(selected).toEqual(["First", "Second", "Third"]);
		expect(window().getState().activeWorkSessionId).toBeNull();
	});

	it("acts on the selection from the hint's menu, and clicking empty space clears it", async () => {
		const { workSessions } = await renderWorkSessions({ workSessions: three() });
		await clickRow("First", { modifiers: ["Meta"] });
		await clickRow("Second", { modifiers: ["Meta"] });

		await page.getByTestId("session-list-selection-actions").click();
		await page.getByTestId("session-bulk-pin").click();
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledTimes(2));

		await clickRow("Third", { modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["Third"]);
		const inbox = page.getByTestId("session-list-inbox").element() as HTMLElement;
		inbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await expect.poll(selected).toEqual([]);
	});

	it("deletes a selection with one confirm and removes the worktree it orphans", async () => {
		const shared = { directory: "/repo/.kilo/worktrees/shared", branch: "kilo/shared" };
		const { workSessions } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "First", ...shared }),
				workSession("b", { title: "Second", ...shared }),
				workSession("c", { title: "Third" }),
			],
		});
		await selectAll();

		await row("Third").click({ button: "right" });
		await page.getByTestId("session-bulk-delete").click();
		const dialog = page.getByTestId("session-bulk-delete-dialog");
		await expect.element(dialog.getByText("kilo/shared")).toBeVisible();
		await page.getByTestId("session-bulk-delete-confirm").click();

		await vi.waitFor(() => expect(workSessions.calls.remove).toHaveBeenCalledTimes(3));
		expect(workSessions.calls.removeCopy).toHaveBeenCalledTimes(3);
		await expect.element(row("First")).not.toBeInTheDocument();
	});

	it("keeps the worktrees when asked", async () => {
		const { workSessions } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "First", directory: "/wt/solo", branch: "kilo/solo" }),
				workSession("b", { title: "Second" }),
				workSession("c", { title: "Third" }),
			],
		});
		await selectAll();
		await row("First").click({ button: "right" });
		await page.getByTestId("session-bulk-delete").click();
		await page.getByTestId("session-bulk-delete-keep-worktrees").click();

		await vi.waitFor(() => expect(workSessions.calls.remove).toHaveBeenCalledTimes(3));
		expect(workSessions.calls.removeCopy).not.toHaveBeenCalled();
	});
});

describe("view options", () => {
	const chooseFrom = async (menu: string, option: string) => {
		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: new RegExp(`^${menu}`) }).click();
		await page.getByRole("menuitemradio", { name: option }).click();
		await userEvent.keyboard("{Escape}{Escape}");
	};

	it("orders by title, filters by status and resets", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("b", { title: "Banana", updatedAt: NOW - 1_000 }),
				workSession("a", { title: "Apple", updatedAt: NOW - 5_000 }),
				workSession("c", { title: "Cherry", archived: true }),
			],
		});
		await expect.element(row("Banana")).toBeVisible();
		expect(titles()).toEqual(["Banana", "Apple"]);

		await chooseFrom("Ordering", "Title");
		await vi.waitFor(() => expect(titles()).toEqual(["Apple", "Banana"]));

		await chooseFrom("Status", "Archived");
		await expect.element(row("Cherry")).toBeVisible();
		await expect.element(row("Apple")).not.toBeInTheDocument();

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: "Reset view" }).click();
		await expect.element(row("Apple")).toBeVisible();
		await expect.element(row("Cherry")).not.toBeInTheDocument();
	});

	it("says when nothing matches a status filter", async () => {
		await renderWorkSessions({ workSessions: [workSession("a")] });

		await chooseFrom("Status", "Working");

		await expect.element(page.getByText('No sessions matching "Working"')).toBeVisible();
	});

	it("shows update times and workspaces on request, and hides decorations with PR", async () => {
		const contributor = contributorPlugin();
		await renderWorkSessions({
			// Updated a minute before this test, not before the file loaded: a
			// slow run reaches it more than a minute after NOW.
			workSessions: [
				workSession("a", {
					title: "Fix login",
					workspaceId: "w-app",
					updatedAt: Date.now() - 60_000,
				}),
			],
			workspaces: [workspace("w-app", "App")],
			guests: [contributor.plugin],
		});
		const toggleShow = async (field: string) => {
			await page.getByTestId("session-list-view-menu").click();
			await page.getByRole("menuitem", { name: /^Show/ }).click();
			await page.getByRole("menuitemcheckbox", { name: field }).click();
			await userEvent.keyboard("{Escape}{Escape}");
		};

		await toggleShow("Updated");
		await expect
			.element(row("Fix login").getByTestId("session-list-item-updated"))
			.toHaveTextContent("1m");
		await toggleShow("Workspace");
		const info = row("Fix login").getByTestId("session-list-item-info");
		await expect.element(info.getByText("App")).toBeVisible();
		await expect.element(info.getByTestId("row-badge-a")).toBeVisible();
		await toggleShow("PR");
		await expect.element(row("Fix login").getByTestId("row-badge-a")).not.toBeInTheDocument();
	});

	it("shows plugins' status glyphs whatever the view options", async () => {
		const contributor = contributorPlugin();
		await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
			guests: [contributor.plugin],
		});
		await expect.element(row("Fix login").getByTestId("live-status-a")).toBeVisible();

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: /^Show/ }).click();
		await page.getByRole("menuitemcheckbox", { name: "PR" }).click();
		await userEvent.keyboard("{Escape}{Escape}");

		await expect.element(row("Fix login").getByTestId("row-badge-a")).not.toBeInTheDocument();
		await expect.element(row("Fix login").getByTestId("live-status-a")).toBeVisible();
	});

	it("collapses and expands every shelf", async () => {
		await renderWorkSessions({ workSessions: [workSession("a", { title: "Fix login" })] });

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: "Collapse All" }).click();
		await expect.element(row("Fix login")).not.toBeInTheDocument();

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: "Expand All" }).click();
		await expect.element(row("Fix login")).toBeVisible();
	});

	it("shows a session's details on hover", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("a", {
					title: "Fix login",
					workspaceId: "w-app",
					branch: "kilo/fix-login",
					directory: "/projects/app/.kilo/worktrees/fix-login",
				}),
			],
			workspaces: [workspace("w-app", "App")],
		});

		await row("Fix login").getByTestId("session-list-item-trigger").hover();

		const details = page.getByTestId("session-list-item-details");
		await expect.element(details.getByText("kilo/fix-login")).toBeVisible();
		await expect.element(details.getByText("fix-login", { exact: true })).toBeVisible();
		await expect.element(details.getByText("App")).toBeVisible();
	});
});

describe("contributions", () => {
	it("adds plugins' menu items, decorations and actions, each given the session", async () => {
		const contributor = contributorPlugin();
		await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
			guests: [contributor.plugin],
		});

		await expect.element(row("Fix login").getByTestId("row-badge-a")).toBeVisible();
		await expect.element(list().getByRole("button", { name: "Board" })).toBeVisible();

		await openRowMenu("Fix login");
		await expect.element(page.getByText("Discard worktree")).not.toBeInTheDocument();
		await page.getByTestId("session-menu-test.contributor/share").click();
		await vi.waitFor(() =>
			expect(contributor.shared).toHaveBeenCalledWith(expect.objectContaining({ id: "a" })),
		);

		await row("Fix login").getByTestId("session-list-item-trigger").click();
		await page.getByRole("button", { name: "Push" }).click();
		expect(contributor.pushed).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
		const buttons = page
			.getByTestId("session-header-actions")
			.getByRole("button")
			.elements()
			.map((element) => element.textContent);
		expect(buttons.indexOf("Commit")).toBeLessThan(buttons.indexOf("Push"));
		expect(buttons.indexOf("Commit")).toBe(0);
	});

	it("shows hover decorations in a session's details, in place of its branch line", async () => {
		const contributor = contributorPlugin();
		await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login", branch: "kilo/fix-login" })],
			guests: [contributor.plugin],
		});

		await row("Fix login").getByTestId("session-list-item-trigger").hover();

		const details = page.getByTestId("session-list-item-details");
		await expect
			.element(details.getByTestId("branch-detail"))
			.toHaveTextContent("live branch of a");
		await expect.element(details.getByTestId("pr-detail")).toHaveTextContent("PR of a");
		await expect.element(details.getByText("kilo/fix-login")).not.toBeInTheDocument();
	});

	it("filters by a pull request facet, offering the filter only with one", async () => {
		const states: Record<string, WorkSessionPullRequestState> = { a: "open", b: "merged" };
		const listeners = new Set<() => void>();
		let current = { ...states };
		const facetPlugin = {
			manifest: {
				manifestVersion: 1,
				id: "test.facet",
				displayName: "Facet",
				version: "1.0.0",
				contributes: {
					extensions: {
						"kilo.work-sessions/work-session-facet": [{ id: "pr", facet: "pull-request" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(WorkSessionFacet, "pr", {
						get: () => current,
						subscribe: (listener) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
					});
				},
			} satisfies PluginEntry,
		};
		await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Open one" }),
				workSession("b", { title: "Merged one" }),
				workSession("c", { title: "No PR" }),
			],
			guests: [facetPlugin],
		});
		const choosePullRequest = async (option: string) => {
			await page.getByTestId("session-list-view-menu").click();
			await page.getByRole("menuitem", { name: /^Pull request/ }).click();
			await page.getByRole("menuitemradio", { name: option }).click();
			await userEvent.keyboard("{Escape}{Escape}");
		};

		await choosePullRequest("Any PR");
		await expect.element(row("Merged one")).toBeVisible();
		await expect.element(row("No PR")).not.toBeInTheDocument();

		await choosePullRequest("Open PR");
		await expect.element(row("Open one")).toBeVisible();
		await expect.element(row("Merged one")).not.toBeInTheDocument();

		current = { ...states, c: "open" };
		for (const listener of listeners) listener();
		await expect.element(row("No PR")).toBeVisible();
	});

	it("groups by a plugin's categories, showing only the sessions in them", async () => {
		const listeners = new Set<() => void>();
		let groups: readonly WorkSessionGroup[] = [
			{ id: "doing", label: "Doing", workSessionIds: ["b", "a"] },
			{ id: "done", label: "Done", workSessionIds: [] },
		];
		const groupingPlugin = {
			manifest: {
				manifestVersion: 1,
				id: "test.grouping",
				displayName: "Grouping",
				version: "1.0.0",
				contributes: {
					extensions: {
						"kilo.work-sessions/work-session-grouping": [{ id: "board", title: "Board" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(WorkSessionGrouping, "board", {
						get: () => groups,
						subscribe: (listener) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
					});
				},
			} satisfies PluginEntry,
		};
		await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Apple", updatedAt: NOW - 1_000 }),
				workSession("b", { title: "Banana", updatedAt: NOW - 5_000 }),
				workSession("c", { title: "Off the board", pinned: true }),
			],
			guests: [groupingPlugin],
		});

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: /^Grouping/ }).click();
		await page.getByRole("menuitemradio", { name: "Board" }).click();
		await userEvent.keyboard("{Escape}{Escape}");

		await expect.element(list().getByRole("button", { name: "Doing" })).toBeVisible();
		await vi.waitFor(() => expect(titles()).toEqual(["Banana", "Apple"]));
		await expect.element(row("Off the board")).not.toBeInTheDocument();
		await expect.element(list().getByRole("button", { name: "Done" })).toBeVisible();
		await expect
			.element(list().getByTestId("session-list-group-empty-done"))
			.toHaveTextContent("No sessions yet");

		groups = [
			{ id: "doing", label: "Doing", workSessionIds: ["b"] },
			{ id: "done", label: "Done", workSessionIds: ["a"] },
		];
		for (const listener of listeners) listener();
		await expect
			.element(list().getByTestId("session-list-group-empty-done"))
			.not.toBeInTheDocument();
		await vi.waitFor(() => expect(titles()).toEqual(["Banana", "Apple"]));

		groups = [];
		for (const listener of listeners) listener();
		await expect.element(page.getByText("No sessions in Board")).toBeVisible();
	});

	it("offers no pull request filter without a facet", async () => {
		await renderWorkSessions({ workSessions: [workSession("a")] });

		await page.getByTestId("session-list-view-menu").click();

		await expect.element(page.getByRole("menuitem", { name: /^Ordering/ })).toBeVisible();
		await expect
			.element(page.getByRole("menuitem", { name: /^Pull request/ }))
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
	});
});

describe("shortcut number chips", () => {
	it("number the sessions while the go-to-session modifier is held", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Newer", updatedAt: NOW - 1_000 }),
				workSession("b", { title: "Older", updatedAt: NOW - 2_000 }),
			],
		});
		await expect.element(row("Newer")).toBeVisible();

		await userEvent.keyboard("{Control>}");
		await expect.element(row("Newer").getByText("⌃1")).toBeVisible();
		await expect.element(row("Older").getByText("⌃2")).toBeVisible();

		await userEvent.keyboard("{/Control}");
		await expect.element(row("Newer").getByText("⌃1")).not.toBeInTheDocument();
	});
});

describe("origin's pins", () => {
	const PINS = "kilo-ui.session-list-pins:v1";

	it("pin the work sessions they name, by id or by chat, once", async () => {
		const { workSessions } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "By id" }),
				workSession("b", { title: "By chat", chatIds: ["ses_b"] }),
				workSession("c", { title: "Not pinned" }),
			],
			localStorage: { [PINS]: JSON.stringify(["a", "ses_b", "gone"]) },
		});

		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledTimes(2));
		expect(workSessions.calls.setPinned).toHaveBeenCalledWith("a", true);
		expect(workSessions.calls.setPinned).toHaveBeenCalledWith("b", true);

		const again = await renderWorkSessions({
			workSessions: [workSession("a")],
			localStorage: { ...localStorage },
		});
		await expect.element(row("Session a")).toBeVisible();
		expect(again.workSessions.calls.setPinned).not.toHaveBeenCalled();
	});

	it("wait for the work sessions they name to be adopted", async () => {
		const { workSessions } = await renderWorkSessions({
			localStorage: { [PINS]: JSON.stringify(["a"]) },
		});
		await expect.element(list()).toBeVisible();
		expect(workSessions.calls.setPinned).not.toHaveBeenCalled();

		workSessions.workSessions().setState({ workSessions: [workSession("a")] });

		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledWith("a", true));
	});
});
