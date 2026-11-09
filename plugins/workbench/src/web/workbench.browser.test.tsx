import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry, PluginSdk } from "@kilo-desktop/kernel";
import {
	DEFAULT_WORK_SESSION_TITLE,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";

import { NOW, renderWorkbench, session, workspace } from "../test/fakes";
import {
	NavigatorAction,
	SessionAction,
	SessionFacet,
	type SessionActionProps,
	type SessionPullRequestState,
	SessionDecoration,
	SessionMenu,
	type SessionDecorationProps,
} from "../contracts";

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
						"kilo.workbench/session-menu": [
							{ id: "share", title: "Share" },
							{ id: "discard", title: "Discard worktree", destructive: true },
						],
						"kilo.workbench/session-decoration": [
							{ id: "row-badge", slot: "row" },
							{ id: "branch-detail", slot: "hover-branch" },
							{ id: "pr-detail", slot: "hover" },
						],
						"kilo.workbench/session-action": [{ id: "push" }, { id: "commit", placement: "start" }],
						"kilo.workbench/navigator-action": [{ id: "board" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(SessionMenu, "share", { run: shared });
					sdk.extensions.implement(SessionMenu, "discard", {
						run: () => undefined,
						appliesTo: (s) => s.worktreeBranch !== null,
					});
					sdk.extensions.implement(
						SessionDecoration,
						"row-badge",
						({ session: s }: SessionDecorationProps) => (
							<span data-qa-id={`row-badge-${s.id}`}>PR</span>
						),
					);
					sdk.extensions.implement(
						SessionDecoration,
						"branch-detail",
						({ session: s }: SessionDecorationProps) => (
							<span data-qa-id="branch-detail">live branch of {s.id}</span>
						),
					);
					sdk.extensions.implement(
						SessionDecoration,
						"pr-detail",
						({ session: s }: SessionDecorationProps) => (
							<span data-qa-id="pr-detail">PR of {s.id}</span>
						),
					);
					sdk.extensions.implement(SessionAction, "commit", () => (
						<button type="button">Commit</button>
					));
					sdk.extensions.implement(SessionAction, "push", ({ session: s }: SessionActionProps) => (
						<button type="button" onClick={() => pushed(s)}>
							Push
						</button>
					));
					sdk.extensions.implement(NavigatorAction, "board", () => (
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
const openRowMenu = async (title: string) => {
	await row(title).hover();
	await row(title).getByTestId("session-list-item-more").click();
};

describe("session list", () => {
	it("groups pinned and active sessions, keeping archived ones collapsed at the end", async () => {
		await renderWorkbench({
			sessions: [
				session("a", { title: "Fix login" }),
				session("b", { title: "Pinned work", pinned: true }),
				session("c", { title: "Old idea", archived: true }),
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
		const { navigator } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App")],
		});

		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("a"));
		await expect.element(row("Fix login")).toHaveAttribute("data-active", "true");
		const breadcrumb = page.getByTestId("session-breadcrumb");
		await expect.element(breadcrumb.getByText("App")).toBeVisible();
		await expect.element(breadcrumb.getByText("Fix login")).toBeVisible();
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
	});

	it("pins from the row menu, and the session moves to Pinned", async () => {
		const { sessions } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledWith("a", true));
		await expect.element(list().getByTestId("session-list-pinned-toggle")).toBeVisible();
	});

	it("archives and restores a session", async () => {
		const { sessions } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-archive").click();
		await vi.waitFor(() => expect(sessions.calls.setArchived).toHaveBeenCalledWith("a", true));

		await list().getByTestId("session-list-archived-toggle").click();
		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-restore").click();
		await vi.waitFor(() => expect(sessions.calls.setArchived).toHaveBeenCalledWith("a", false));
	});

	it("renames inline from the menu, and keeps editing with the reason when it fails", async () => {
		const { sessions } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-rename").click();
		sessions.failNextWith("Title is taken.");
		await page.getByTestId("session-list-item-rename").fill("Fix sign-in");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByText("Title is taken.")).toBeVisible();

		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() =>
			expect(sessions.calls.rename).toHaveBeenLastCalledWith("a", "Fix sign-in"),
		);
		await expect.element(row("Fix sign-in")).toBeVisible();
	});

	it("deletes only after confirmation, and closes the session if it was open", async () => {
		const { sessions, navigator } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login" })],
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-cancel").click();
		expect(sessions.calls.remove).not.toHaveBeenCalled();

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-confirm").click();

		await vi.waitFor(() => expect(sessions.calls.remove).toHaveBeenCalledWith("a"));
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBeNull());
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
	});

	it("groups by workspace, filters to one, and starts a session in a workspace from its shelf", async () => {
		const { workspaces, navigator } = await renderWorkbench({
			sessions: [
				session("a", { title: "App work", workspaceId: "w-app" }),
				session("b", { title: "Docs work", workspaceId: "w-docs" }),
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
		await vi.waitFor(() => expect(navigator().getState().focus).toBe("w-docs"));
		await expect.element(row("Docs work")).toBeVisible();
		await expect.element(row("App work")).not.toBeInTheDocument();
		expect(workspaces.setActive).toHaveBeenCalledWith("w-docs");

		await list().getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /All workspaces/ }).click();
		await list().getByTestId("session-list-workspace-new-w-app").click({ force: true });
		await vi.waitFor(() => expect(workspaces.setActive).toHaveBeenLastCalledWith("w-app"));
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
	});

	it("edits, deletes and adds workspaces through kilo.workspaces' commands", async () => {
		const { workspaces } = await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			localStorage: {
				"kilo-ui.session-list-view:v1": JSON.stringify({ grouping: "workspace" }),
			},
		});

		await list().getByTestId("session-list-workspace-actions-w-app").click({ force: true });
		await page.getByRole("menuitem", { name: "Edit" }).click();
		await vi.waitFor(() =>
			expect(workspaces.commands.edit).toHaveBeenCalledWith({ workspaceId: "w-app" }),
		);

		await list().getByTestId("session-list-workspace-actions-w-app").click({ force: true });
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await vi.waitFor(() =>
			expect(workspaces.commands.delete).toHaveBeenCalledWith({ workspaceId: "w-app" }),
		);

		await list().getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /New workspace/ }).click();
		await vi.waitFor(() => expect(workspaces.commands.add).toHaveBeenCalled());
	});

	it("shows the workspace of a session opened while the list is focused on another", async () => {
		const { navigator } = await renderWorkbench({
			sessions: [session("docs", { title: "Docs work", workspaceId: "w-docs" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: "w-app", activeSessionId: null }),
			},
		});
		await expect.element(row("Docs work")).not.toBeInTheDocument();

		await navigator().methods.openSession({ sessionId: "docs" });

		await vi.waitFor(() => expect(navigator().getState().focus).toBe("w-docs"));
		await expect.element(row("Docs work")).toBeVisible();
	});

	it("keeps the list's focus when the opened session is already in it", async () => {
		const { navigator } = await renderWorkbench({
			sessions: [session("app", { title: "App work", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: "w-app", activeSessionId: null }),
			},
		});

		await navigator().methods.openSession({ sessionId: "app" });

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("app"));
		expect(navigator().getState().focus).toBe("w-app");
	});

	it("explains an empty focused list", async () => {
		await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: "w-app", activeSessionId: null }),
			},
		});

		await expect.element(page.getByText("No sessions in App")).toBeVisible();
	});

	it("adopts origin's workspace filter on first run", async () => {
		const { navigator } = await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			localStorage: { "kilo-ui.session-list-view:v1": JSON.stringify({ focus: "w-app" }) },
		});

		expect(navigator().getState().focus).toBe("w-app");
	});
});

describe("multi-selection", () => {
	const trigger = (title: string) => row(title).getByTestId("session-list-item-trigger");
	const selected = () =>
		[...document.querySelectorAll('[data-selected] [data-qa-id="session-list-item-title"]')]
			.map((node) => node.textContent)
			.sort();
	const three = () => [
		session("a", { title: "First", updatedAt: NOW - 1_000 }),
		session("b", { title: "Second", updatedAt: NOW - 2_000 }),
		session("c", { title: "Third", updatedAt: NOW - 3_000 }),
	];
	const selectAll = async () => {
		for (const title of ["First", "Second", "Third"]) {
			await trigger(title).click({ modifiers: ["Meta"] });
		}
		await expect.poll(selected).toEqual(["First", "Second", "Third"]);
	};

	it("selects with Meta- and Shift-click without opening, and clears on Escape or a plain click", async () => {
		const { navigator } = await renderWorkbench({ sessions: three() });

		await trigger("First").click({ modifiers: ["Meta"] });
		await trigger("Third").click({ modifiers: ["Shift"] });
		await expect.poll(selected).toEqual(["First", "Second", "Third"]);
		await trigger("Second").click({ modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["First", "Third"]);
		await expect
			.element(page.getByTestId("session-list-selection-hint"))
			.toHaveTextContent("2 selected · Esc to clear");
		expect(navigator().getState().activeSessionId).toBeNull();

		await userEvent.keyboard("{Escape}");
		await expect.poll(selected).toEqual([]);
		await expect.element(page.getByTestId("session-list-selection-hint")).not.toBeInTheDocument();

		await trigger("First").click({ modifiers: ["Meta"] });
		await trigger("Second").click();
		await expect.poll(selected).toEqual([]);
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("b"));
	});

	it("adds the open session to the first Meta-click", async () => {
		await renderWorkbench({ sessions: three() });

		await trigger("First").click();
		await trigger("Third").click({ modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["First", "Third"]);
	});

	it("archives and pins a selection from the right-click menu", async () => {
		const { sessions } = await renderWorkbench({ sessions: three() });
		await selectAll();

		await row("Second").click({ button: "right" });
		await expect.element(page.getByText("3 sessions selected")).toBeVisible();
		await page.getByTestId("session-bulk-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledTimes(3));
		await expect.poll(selected).toEqual([]);

		await selectAll();
		await row("First").click({ button: "right" });
		await page.getByTestId("session-bulk-archive").click();
		await vi.waitFor(() => expect(sessions.calls.setArchived).toHaveBeenCalledTimes(3));
	});

	it("right-clicking one session shows its own menu and clears a selection it isn't in", async () => {
		const { sessions } = await renderWorkbench({ sessions: three() });
		await trigger("First").click({ modifiers: ["Meta"] });
		await trigger("Second").click({ modifiers: ["Meta"] });

		await row("Third").click({ button: "right" });
		await expect.poll(selected).toEqual([]);
		await expect.element(page.getByText(/sessions selected/)).not.toBeInTheDocument();
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledWith("c", true));
	});

	it("selects from the keyboard: arrows move, Shift+arrows grow and shrink, Cmd+A selects all", async () => {
		const { navigator } = await renderWorkbench({ sessions: three() });
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
		expect(navigator().getState().activeSessionId).toBeNull();
	});

	it("acts on the selection from the hint's menu, and clicking empty space clears it", async () => {
		const { sessions } = await renderWorkbench({ sessions: three() });
		await trigger("First").click({ modifiers: ["Meta"] });
		await trigger("Second").click({ modifiers: ["Meta"] });

		await page.getByTestId("session-list-selection-actions").click();
		await page.getByTestId("session-bulk-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledTimes(2));

		await trigger("Third").click({ modifiers: ["Meta"] });
		await expect.poll(selected).toEqual(["Third"]);
		const inbox = page.getByTestId("session-list-inbox").element() as HTMLElement;
		inbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await expect.poll(selected).toEqual([]);
	});

	it("deletes a selection with one confirm and removes the worktree it orphans", async () => {
		const shared = { directory: "/repo/.kilo/worktrees/shared", worktreeBranch: "kilo/shared" };
		const { sessions } = await renderWorkbench({
			sessions: [
				session("a", { title: "First", ...shared }),
				session("b", { title: "Second", ...shared }),
				session("c", { title: "Third" }),
			],
		});
		await selectAll();

		await row("Third").click({ button: "right" });
		await page.getByTestId("session-bulk-delete").click();
		const dialog = page.getByTestId("session-bulk-delete-dialog");
		await expect.element(dialog.getByText("kilo/shared")).toBeVisible();
		await page.getByTestId("session-bulk-delete-confirm").click();

		await vi.waitFor(() => expect(sessions.calls.remove).toHaveBeenCalledTimes(3));
		expect(sessions.calls.removeWorktree).toHaveBeenCalledTimes(3);
		await expect.element(row("First")).not.toBeInTheDocument();
	});

	it("keeps the worktrees when asked", async () => {
		const { sessions } = await renderWorkbench({
			sessions: [
				session("a", { title: "First", directory: "/wt/solo", worktreeBranch: "kilo/solo" }),
				session("b", { title: "Second" }),
				session("c", { title: "Third" }),
			],
		});
		await selectAll();
		await row("First").click({ button: "right" });
		await page.getByTestId("session-bulk-delete").click();
		await page.getByTestId("session-bulk-delete-keep-worktrees").click();

		await vi.waitFor(() => expect(sessions.calls.remove).toHaveBeenCalledTimes(3));
		expect(sessions.calls.removeWorktree).not.toHaveBeenCalled();
	});
});

describe("view options", () => {
	const chooseFrom = async (menu: string, option: string) => {
		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: new RegExp(`^${menu}`) }).click();
		await page.getByRole("menuitemradio", { name: option }).click();
		await userEvent.keyboard("{Escape}{Escape}");
	};
	const titles = () =>
		list()
			.getByTestId("session-list-item-title")
			.elements()
			.map((element) => element.textContent);

	it("orders by title, filters by status and resets", async () => {
		await renderWorkbench({
			sessions: [
				session("b", { title: "Banana", updatedAt: NOW - 1_000 }),
				session("a", { title: "Apple", updatedAt: NOW - 5_000 }),
				session("c", { title: "Cherry", archived: true }),
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
		await renderWorkbench({ sessions: [session("a")] });

		await chooseFrom("Status", "Working");

		await expect.element(page.getByText('No sessions matching "Working"')).toBeVisible();
	});

	it("shows update times and workspaces on request, and hides decorations with PR", async () => {
		const contributor = contributorPlugin();
		await renderWorkbench({
			sessions: [session("a", { title: "Fix login", workspaceId: "w-app" })],
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

	it("collapses and expands every shelf", async () => {
		await renderWorkbench({ sessions: [session("a", { title: "Fix login" })] });

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: "Collapse All" }).click();
		await expect.element(row("Fix login")).not.toBeInTheDocument();

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: "Expand All" }).click();
		await expect.element(row("Fix login")).toBeVisible();
	});

	it("shows a session's details on hover", async () => {
		await renderWorkbench({
			sessions: [
				session("a", {
					title: "Fix login",
					workspaceId: "w-app",
					worktreeBranch: "kilo/fix-login",
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
		await renderWorkbench({
			sessions: [session("a", { title: "Fix login" })],
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
		await renderWorkbench({
			sessions: [session("a", { title: "Fix login", worktreeBranch: "kilo/fix-login" })],
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
		const states: Record<string, SessionPullRequestState> = { a: "open", b: "merged" };
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
						"kilo.workbench/session-facet": [{ id: "pr", facet: "pull-request" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(SessionFacet, "pr", {
						get: () => current,
						subscribe: (listener) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
					});
				},
			} satisfies PluginEntry,
		};
		await renderWorkbench({
			sessions: [
				session("a", { title: "Open one" }),
				session("b", { title: "Merged one" }),
				session("c", { title: "No PR" }),
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

	it("offers no pull request filter without a facet", async () => {
		await renderWorkbench({ sessions: [session("a")] });

		await page.getByTestId("session-list-view-menu").click();

		await expect.element(page.getByRole("menuitem", { name: /^Ordering/ })).toBeVisible();
		await expect
			.element(page.getByRole("menuitem", { name: /^Pull request/ }))
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
	});
});

describe("launcher and commands", () => {
	it("starts a session in the active workspace and opens it", async () => {
		const { sessions, navigator, run } = await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
		});

		await expect
			.element(page.getByTestId("launcher-headline"))
			.toHaveTextContent("What should we work on in App?");
		await run("new-empty-session");

		await vi.waitFor(() =>
			expect(sessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" }),
		);
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"));
		await expect.element(row(DEFAULT_WORK_SESSION_TITLE)).toBeVisible();
	});

	it("reports a session that could not be started", async () => {
		const { sessions, run } = await renderWorkbench();
		sessions.failNextWith("Disk full.");
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();

		await run("new-empty-session");

		await expect.element(page.getByText("Disk full.")).toBeVisible();
	});

	it("New session returns to the launcher in the open session's workspace", async () => {
		const { run, navigator, workspaces } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login", workspaceId: "w-docs" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			activeWorkspaceId: "w-app",
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await run("new-session");

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBeNull());
		expect(workspaces.setActive).toHaveBeenCalledWith("w-docs");
		await expect
			.element(page.getByTestId("launcher-headline"))
			.toHaveTextContent("What should we work on in Docs?");
	});

	it("the New session entry opens the launcher too", async () => {
		const { navigator } = await renderWorkbench({ sessions: [session("a")] });
		await row("Session a").getByTestId("session-list-item-trigger").click();

		await page.getByTestId("new-chat").click();

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBeNull());
	});

	it("searches sessions and workspaces", async () => {
		const { run, navigator } = await renderWorkbench({
			sessions: [
				session("a", { title: "Fix login" }),
				session("b", { title: "Old login idea", archived: true }),
				session("c", { title: "Write docs" }),
			],
			workspaces: [workspace("w-app", "App")],
		});

		await run("search");
		await page.getByTestId("session-search-input").fill("login");
		await expect.element(page.getByTestId("session-search-session-b")).toBeVisible();
		await expect.element(page.getByTestId("session-search-session-c")).not.toBeInTheDocument();
		await page.getByTestId("session-search-session-a").click();
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("a"));

		await page.getByTestId("session-list-search").click();
		await page.getByTestId("session-search-filter-workspaces").click();
		await page.getByTestId("session-search-workspace-w-app").click();
		await vi.waitFor(() => expect(navigator().getState().focus).toBe("w-app"));
	});

	it("moves through sessions in the order the list shows them, and pins the open one", async () => {
		const { run, navigator, sessions } = await renderWorkbench({
			sessions: [
				session("old", { title: "Older", updatedAt: NOW - 3_000 }),
				session("new", { title: "Newer", updatedAt: NOW - 1_000 }),
				session("arch", { title: "Archived", archived: true }),
			],
		});
		await expect.element(row("Newer")).toBeVisible();
		const active = () => navigator().getState().activeSessionId;

		await run("next-session");
		await vi.waitFor(() => expect(active()).toBe("new"));
		await run("next-session");
		await vi.waitFor(() => expect(active()).toBe("old"));
		await run("previous-session");
		await vi.waitFor(() => expect(active()).toBe("new"));
		await run("session-last");
		await vi.waitFor(() => expect(active()).toBe("old"));
		await run("session-1");
		await vi.waitFor(() => expect(active()).toBe("new"));

		await run("toggle-pin-session");
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledWith("new", true));
	});

	it("forgets an open session that was deleted elsewhere", async () => {
		const { navigator } = await renderWorkbench({
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: null, activeSessionId: "gone" }),
			},
		});

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBeNull());
	});
});
