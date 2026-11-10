import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";

import { NOW, paneKindPlugin, renderWorkSessions, workSession, workspace } from "../../testing";
import {
	WorkSessionAction,
	type WorkSessionActionProps,
	type WorkSession,
	PANE_TARGET_ACTIVE_KEY,
	WORK_SESSION_ACTIVE_KEY,
	WORKSPACE_ACTIVE_KEY,
} from "../../contracts";
import { visibleWorkSessions } from "../shared/list-state";
import { registerNewWorkSessionStart } from "../shared/new-work-session-start";

const saved = (state: Record<string, unknown>) => ({
	"kilo.work-sessions.window:main": JSON.stringify(state),
});

/** A plugin adding buttons to the open work session's header. */
function headerActionsPlugin() {
	const pushed = vi.fn<(workSession: WorkSession) => void>();
	return {
		pushed,
		plugin: {
			manifest: testManifest("test.actions", {
				contributes: {
					extensions: {
						"kilo.work-sessions/work-session-action": [
							{ id: "push" },
							{ id: "commit", placement: "start" },
						],
					},
				},
			}),
			web: definePlugin({
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(WorkSessionAction, "commit", () => (
						<button type="button">Commit</button>
					));
					sdk.extensions.implement(
						WorkSessionAction,
						"push",
						({ workSession: shown }: WorkSessionActionProps) => (
							<button type="button" onClick={() => pushed(shown)}>
								Push
							</button>
						),
					);
				},
			}),
		},
	};
}

describe("the window object", () => {
	it("opens a work session: the header names its workspace and title, and the canvas shows", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App")],
		});

		await window().methods.openWorkSession({ workSessionId: "a" });

		const breadcrumb = page.getByTestId("session-breadcrumb");
		await expect.element(breadcrumb.getByText("App")).toBeVisible();
		await expect.element(breadcrumb.getByText("Fix login")).toBeVisible();
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
	});

	it("names a deleted workspace's work session by its folder", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Fix login", workspaceId: "w-gone", directory: "/src/app" }),
			],
			open: "a",
		});

		const breadcrumb = page.getByTestId("session-breadcrumb");
		await expect.element(breadcrumb.getByText("app", { exact: true })).toBeVisible();
	});

	it("moves the focus to the workspace of a work session opened while the list shows another", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [workSession("docs", { title: "Docs work", workspaceId: "w-docs" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			localStorage: saved({ focus: "w-app", activeWorkSessionId: null }),
		});

		await window().methods.openWorkSession({ workSessionId: "docs" });

		await vi.waitFor(() => expect(window().getState().focus).toBe("w-docs"));
	});

	it("moves the focus to unscoped work sessions for one without a workspace", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [workSession("loose")],
			workspaces: [workspace("w-app", "App")],
			localStorage: saved({ focus: "w-app", activeWorkSessionId: null }),
		});

		await window().methods.openWorkSession({ workSessionId: "loose" });

		await vi.waitFor(() => expect(window().getState().focus).toBe("unscoped"));
	});

	it("keeps the list's focus when the opened work session is already in it", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [workSession("app", { title: "App work", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			localStorage: saved({ focus: "w-app", activeWorkSessionId: null }),
		});

		await window().methods.openWorkSession({ workSessionId: "app" });

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("app"));
		expect(window().getState().focus).toBe("w-app");
	});

	it("adopts kilo.workbench's saved state, else origin's workspace filter, on first run", async () => {
		const first = await renderWorkSessions({
			workSessions: [workSession("a")],
			workspaces: [workspace("w-app", "App")],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: "w-app", activeSessionId: "a" }),
			},
		});
		expect(first.window().getState()).toMatchObject({ focus: "w-app", activeWorkSessionId: "a" });

		const second = await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			localStorage: { "kilo-ui.session-list-view:v1": JSON.stringify({ focus: "w-app" }) },
		});
		expect(second.window().getState().focus).toBe("w-app");
	});

	it("remembers what the window shows across reloads, and survives unreadable storage", async () => {
		const { window } = await renderWorkSessions({ workSessions: [workSession("a")] });
		await window().methods.setFocus({ focus: "w-app" });
		await window().methods.openWorkSession({ workSessionId: "a" });
		expect(JSON.parse(localStorage.getItem("kilo.work-sessions.window:main")!)).toEqual({
			focus: "unscoped",
			activeWorkSessionId: "a",
			view: null,
		});

		const broken = await renderWorkSessions({
			localStorage: { "kilo.work-sessions.window:main": "{not json" },
		});
		expect(broken.window().getState()).toMatchObject({ focus: null, activeWorkSessionId: null });
	});

	it("forgets an open work session that was deleted elsewhere", async () => {
		const { window } = await renderWorkSessions({ open: "gone" });

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBeNull());
	});

	it("closes the open work session back to the New Session page", async () => {
		const { window, host } = await renderWorkSessions({
			workSessions: [workSession("a")],
			open: "a",
		});
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();

		await window().methods.closeWorkSession(undefined);

		await expect.element(page.getByTestId("session-workbench")).not.toBeInTheDocument();
		expect(host.renderer.contextKeys.get(WORK_SESSION_ACTIVE_KEY)).toBe(false);
	});

	it("publishes whether a work session is open, a workspace is focused and a pane has a target", async () => {
		const { window, host } = await renderWorkSessions({ workSessions: [workSession("a")] });
		const key = (id: string) => host.renderer.contextKeys.get(id);
		expect([
			key(WORK_SESSION_ACTIVE_KEY),
			key(WORKSPACE_ACTIVE_KEY),
			key(PANE_TARGET_ACTIVE_KEY),
		]).toEqual([false, false, true]);

		await window().methods.openWorkSession({ workSessionId: "a" });
		await window().methods.setFocus({ focus: "unscoped" });
		expect([key(WORK_SESSION_ACTIVE_KEY), key(WORKSPACE_ACTIVE_KEY)]).toEqual([true, true]);

		await window().methods.showView({ view: "test.board/board" });
		expect([key(WORK_SESSION_ACTIVE_KEY), key(PANE_TARGET_ACTIVE_KEY)]).toEqual([false, false]);
	});

	it("opens a pane of a kind in the open work session, showing its last one of the kind again", async () => {
		const { window, panesState } = await renderWorkSessions({
			workSessions: [workSession("a")],
			open: "a",
			guests: [paneKindPlugin("test.kinds", [{ id: "tool", component: () => <p>Tool</p> }])],
		});

		await window().methods.openPane({ kind: "test.kinds/tool" });
		await vi.waitFor(() => expect(panesState("a").panes).toHaveLength(1));
		const [first] = panesState("a").panes;

		await window().methods.openPane({ kind: "test.kinds/tool" });
		expect(panesState("a").panes).toHaveLength(1);
		expect(panesState("a").activePaneId).toBe(first!.id);
	});

	it("starts a work session from the New Session page for a pane when none is open", async () => {
		const { window } = await renderWorkSessions();
		const start = vi.fn();
		const unregister = registerNewWorkSessionStart(start);

		await window().methods.openPane({ kind: "test.kinds/tool" });

		expect(start).toHaveBeenCalledWith("test.kinds/tool");
		unregister();
	});
});

describe("work session commands", () => {
	it("moves through work sessions in the order the list shows them", async () => {
		const { run, window } = await renderWorkSessions({
			workSessions: [
				workSession("old", { title: "Older", updatedAt: NOW - 3_000 }),
				workSession("new", { title: "Newer", updatedAt: NOW - 1_000 }),
			],
		});
		visibleWorkSessions.set(["new", "old"]);
		const active = () => window().getState().activeWorkSessionId;

		await run("next-work-session");
		await vi.waitFor(() => expect(active()).toBe("new"));
		await run("next-work-session");
		await vi.waitFor(() => expect(active()).toBe("old"));
		await run("previous-work-session");
		await vi.waitFor(() => expect(active()).toBe("new"));
		await run("work-session-last");
		await vi.waitFor(() => expect(active()).toBe("old"));
		await run("work-session-1");
		await vi.waitFor(() => expect(active()).toBe("new"));
		await run("work-session-8");
		expect(active()).toBe("new");
	});

	it("opens a work session and shows a work sessions view by id", async () => {
		const { run, window } = await renderWorkSessions({ workSessions: [workSession("a")] });

		await run("open-work-session", { workSessionId: "a" });
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("a"));
		await run("open-work-session", { nope: true });

		await run("show-work-sessions-view", { view: "test.board/board" });
		await vi.waitFor(() => expect(window().getState().view).toBe("test.board/board"));
		await run("show-work-sessions-view");
		expect(window().getState().view).toBe("test.board/board");
	});
});

describe("header actions", () => {
	it("adds plugins' work session actions around the pane controls, each given the work session", async () => {
		const actions = headerActionsPlugin();
		await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
			open: "a",
			guests: [actions.plugin],
		});

		await page.getByRole("button", { name: "Push" }).click();
		expect(actions.pushed).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
		const buttons = page
			.getByTestId("session-header-actions")
			.getByRole("button")
			.elements()
			.map((element) => element.textContent);
		expect(buttons.indexOf("Commit")).toBe(0);
		expect(buttons.indexOf("Commit")).toBeLessThan(buttons.indexOf("Push"));
	});
});
