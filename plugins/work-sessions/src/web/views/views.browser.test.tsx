import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, KernelWindowView, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";

import { WorkSessionsView, type WorkSessionsViewProps } from "../../contracts";
import { renderWorkSessions, workSession as session, workspace } from "../../testing";

const VIEW = "test.views/timeline";

function hostWindows() {
	return {
		open: vi.fn(async () => "w9"),
		focus: vi.fn(),
		close: vi.fn(),
		setHidden: vi.fn(),
		focusMain: vi.fn(),
	};
}

/** A plugin with a detachable sessions view that lists what it is given. */
const viewsPlugin = {
	manifest: testManifest("test.views", {
		contributes: {
			extensions: {
				"kilo.work-sessions/work-sessions-view": [
					{ id: "timeline", title: "Timeline", detachable: true },
				],
			},
		},
	}),
	web: definePlugin({
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(WorkSessionsView, "timeline", {
				component: ({ focus, openWorkSession, detached }: WorkSessionsViewProps) => (
					<div data-qa-id="timeline">
						<span data-qa-id="timeline-focus">{focus ?? "all"}</span>
						<span data-qa-id="timeline-detached">{detached ? "detached" : "in place"}</span>
						<button type="button" onClick={() => openWorkSession("a")}>
							Open a
						</button>
					</div>
				),
				headerActions: () => <button type="button">Timeline action</button>,
				preferredWidth: () => 900,
			});
		},
	}),
};

/** Lifts what a test renders itself above the shell's window. */
const Above = ({ children }: { readonly children: ReactNode }) => (
	<div style={{ position: "fixed", inset: 0, zIndex: 40, background: "white" }}>{children}</div>
);

const list = () => page.getByTestId("kilo-thread-list");
const row = (title: string) =>
	list()
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });

describe("work sessions views", () => {
	it("shows a view in place of the open session, with its title and actions, and opens sessions", async () => {
		const { window } = await renderWorkSessions({
			workSessions: [session("a", { title: "Fix login", workspaceId: "w1" })],
			workspaces: [workspace("w1", "App")],
			guests: [viewsPlugin],
			localStorage: { "kilo.work-sessions.window:main": JSON.stringify({ focus: "w1" }) },
			open: "a",
		});
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();

		await window().methods.showView({ view: VIEW });

		await expect.element(page.getByTestId("timeline-focus")).toHaveTextContent("w1");
		await expect.element(page.getByTestId("timeline-detached")).toHaveTextContent("in place");
		await expect
			.element(page.getByTestId("sessions-view-title").getByText("Timeline"))
			.toBeVisible();
		await expect
			.element(page.getByTestId("sessions-view-title").getByText("App"))
			.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Timeline action" })).toBeVisible();
		expect(page.getByTestId("sessions-view-pop-out").elements()).toHaveLength(0);
		expect(row("Fix login").element().getAttribute("data-active")).toBeNull();

		await page.getByRole("button", { name: "Open a" }).click();

		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
		expect(window().getState()).toMatchObject({ activeWorkSessionId: "a", view: null });
	});

	it("falls back to the open session when the shown view is not contributed", async () => {
		const { window } = await renderWorkSessions({ workSessions: [session("a")], open: "a" });

		await window().methods.showView({ view: VIEW });

		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
	});

	it("pops a detachable view out, brings its window forward, and docks it", async () => {
		const windows = hostWindows();
		const { host, window, run } = await renderWorkSessions({
			workSessions: [session("a")],
			guests: [viewsPlugin],
			windows,
		});
		await window().methods.showView({ view: VIEW });

		await page.getByTestId("sessions-view-pop-out").click();
		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					view: "kilo.work-sessions/work-sessions-view",
					title: "Timeline",
					params: { view: VIEW },
					width: 900,
				}),
			),
		);
		await vi.waitFor(() => expect(window().getState().view).toBeNull());
		host.main.windowEvents.opened("w9", {
			role: "secondary",
			view: "kilo.work-sessions/work-sessions-view",
		});
		await vi.waitFor(() => expect(window().getState().detachedViews).toEqual([VIEW]));

		await window().methods.showView({ view: VIEW });
		expect(windows.focus).toHaveBeenCalledWith("w9");
		expect(window().getState().view).toBeNull();

		await run("show-work-sessions-view", { view: VIEW });
		const placeholder = page.getByTestId("sessions-view-popped-out");
		await expect.element(placeholder).toBeVisible();
		await placeholder.getByRole("button", { name: "Dock" }).click();
		expect(windows.close).toHaveBeenCalledWith("w9");
		host.main.windowEvents.closed("w9");
		await expect.element(page.getByTestId("timeline")).toBeVisible();
	});

	it("shows the view in its window, opening sessions and docking through the main window", async () => {
		const windows = hostWindows();
		const { host, window } = await renderWorkSessions({
			workSessions: [session("a")],
			guests: [viewsPlugin],
			windows,
		});
		const windowView = host.renderer.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.work-sessions/work-sessions-view")!;
		const show = (params: Record<string, string>) =>
			render(
				<KernelProvider kernel={host.renderer}>
					<Above>
						<RenderContribution contribution={windowView} props={{ params }} />
					</Above>
				</KernelProvider>,
			);
		const shown = show({ view: VIEW });
		const content = page.getByTestId("sessions-view-window");
		await expect.element(content.getByTestId("timeline-detached")).toHaveTextContent("detached");

		await content.getByRole("button", { name: "Open a" }).click();
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("a"));
		expect(windows.focusMain).toHaveBeenCalled();

		await page.getByTestId("sessions-view-dock").click();
		await vi.waitFor(() => expect(window().getState().view).toBe(VIEW));
		shown.unmount();

		show({ view: "test.views/gone" });
		await expect.element(page.getByTestId("sessions-view-gone")).toBeVisible();
	});
});
