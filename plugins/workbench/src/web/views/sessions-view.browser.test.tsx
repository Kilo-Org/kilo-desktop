import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelWindowView, OBJECT_REFS_FORMAT, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution, useExclusive } from "@kilo-desktop/kernel/web";
import {
	SessionDecoration,
	SessionMenu,
	SessionRenderer,
	Sessions,
	type Session,
	type SessionRenderers,
} from "@kilo-desktop/plugin-sessions/contracts";

import { chat, NOW, renderWorkbench, session, workspace } from "../../test/fakes";
import { SessionsView, type SessionsViewProps } from "../../contracts";

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
				"kilo.workbench/sessions-view": [{ id: "timeline", title: "Timeline", detachable: true }],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(SessionsView, "timeline", {
				component: ({ focus, openSession, detached }: SessionsViewProps) => (
					<div data-qa-id="timeline">
						<span data-qa-id="timeline-focus">{focus ?? "all"}</span>
						<span data-qa-id="timeline-detached">{detached ? "detached" : "in place"}</span>
						<button type="button" onClick={() => openSession("a")}>
							Open a
						</button>
					</div>
				),
				headerActions: () => <button type="button">Timeline action</button>,
				preferredWidth: () => 900,
			});
		},
	},
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

describe("sessions views", () => {
	it("shows a view in place of the open session, with its title and actions, and opens sessions", async () => {
		const { navigator } = await renderWorkbench({
			sessions: [session("a", { title: "Fix login", workspaceId: "w1" })],
			workspaces: [workspace("w1", "App")],
			guests: [viewsPlugin],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ focus: "w1", activeSessionId: "a" }),
			},
		});
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();

		await navigator().methods.showView({ view: VIEW });

		await expect.element(page.getByTestId("timeline-focus")).toHaveTextContent("w1");
		await expect.element(page.getByTestId("timeline-detached")).toHaveTextContent("in place");
		await expect
			.element(page.getByTestId("sessions-view-title").getByText("Timeline"))
			.toBeVisible();
		await expect.element(page.getByTestId("sessions-view-title").getByText("App")).toBeVisible();
		await expect.element(page.getByRole("button", { name: "Timeline action" })).toBeVisible();
		expect(page.getByTestId("sessions-view-pop-out").elements()).toHaveLength(0);
		expect(row("Fix login").element().getAttribute("data-active")).toBeNull();
		expect(localStorage.getItem("kilo.workbench.navigator:main")).toContain(VIEW);

		await page.getByRole("button", { name: "Open a" }).click();

		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
		expect(navigator().getState()).toMatchObject({ activeSessionId: "a", view: null });
	});

	it("falls back to the open session when the saved view is no longer contributed", async () => {
		await renderWorkbench({
			sessions: [session("a")],
			localStorage: {
				"kilo.workbench.navigator:main": JSON.stringify({ activeSessionId: "a", view: VIEW }),
			},
		});
		await expect.element(page.getByTestId("session-workbench")).toBeVisible();
	});

	it("pops a detachable view out, brings its window forward, and docks it", async () => {
		const windows = hostWindows();
		const { host, navigator, run } = await renderWorkbench({
			sessions: [session("a")],
			guests: [viewsPlugin],
			windows,
		});
		await navigator().methods.showView({ view: VIEW });

		await page.getByTestId("sessions-view-pop-out").click();
		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					view: "kilo.workbench/sessions-view-window",
					title: "Timeline",
					params: { view: VIEW },
					width: 900,
				}),
			),
		);
		await vi.waitFor(() => expect(navigator().getState().view).toBeNull());
		host.main.windowEvents.opened("w9", {
			role: "secondary",
			view: "kilo.workbench/sessions-view-window",
		});
		await vi.waitFor(() => expect(navigator().getState().detachedViews).toEqual([VIEW]));

		await navigator().methods.showView({ view: VIEW });
		expect(windows.focus).toHaveBeenCalledWith("w9");
		expect(navigator().getState().view).toBeNull();

		await run("show-sessions-view", { view: VIEW });
		const placeholder = page.getByTestId("sessions-view-popped-out");
		await expect.element(placeholder).toBeVisible();
		await placeholder.getByRole("button", { name: "Dock" }).click();
		expect(windows.close).toHaveBeenCalledWith("w9");
		host.main.windowEvents.closed("w9");
		await expect.element(page.getByTestId("timeline")).toBeVisible();
	});

	it("shows the view in its window, opening sessions and docking through the main window", async () => {
		const windows = hostWindows();
		const { host, navigator } = await renderWorkbench({
			sessions: [session("a")],
			guests: [viewsPlugin],
			windows,
		});
		const windowView = host.renderer.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.workbench/sessions-view-window")!;
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
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("a"));
		expect(windows.focusMain).toHaveBeenCalled();

		await page.getByTestId("sessions-view-dock").click();
		await vi.waitFor(() => expect(navigator().getState().view).toBe(VIEW));
		shown.unmount();

		show({ view: "test.views/gone" });
		await expect.element(page.getByTestId("sessions-view-gone")).toBeVisible();
	});
});

/** Renders the session renderers the way another plugin's surface does. */
function rendererProbe() {
	const rename = vi.fn();
	function Probe({ session: shown }: { readonly session: Session }) {
		const renderer = useExclusive(SessionRenderer).winner;
		if (!renderer) return null;
		const part = (pick: (renderers: SessionRenderers) => unknown, props: object) => (
			<RenderContribution
				contribution={renderer}
				select={pick as never}
				props={{ session: shown, ...props }}
			/>
		);
		return (
			<div data-qa-id={`probe-${shown.id}`}>
				{part((r) => r.Glyph, { decorative: false })}
				{part((r) => r.Status, {})}
				{part((r) => r.Decorations, { slot: "row" })}
				{part((r) => r.Menu, shown.id === "a" ? { onRename: rename, label: "Card menu" } : {})}
			</div>
		);
	}
	return { Probe, rename };
}

describe("session renderers", () => {
	it("show a session's live status, decorations and menu outside the list", async () => {
		const { Probe, rename } = rendererProbe();
		const decorations = {
			manifest: testManifest("test.decorations", {
				contributes: {
					extensions: { "kilo.sessions/session-decoration": [{ id: "badge", slot: "row" }] },
				},
			}),
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(
						SessionDecoration,
						"badge",
						({ session: s }: { session: Session }) => <span data-qa-id={`badge-${s.id}`}>PR</span>,
					);
				},
			},
		};
		const { host, sessions } = await renderWorkbench({
			sessions: [
				session("a", { title: "Busy", chatIds: ["c1"] }),
				session("b", { title: "Old", archived: true }),
				session("c", { title: "Quiet" }),
			],
			chats: [chat("c1", { status: "busy", workingSince: NOW - 1_000 })],
			guests: [decorations],
		});
		const probes = (
			<KernelProvider kernel={host.renderer}>
				<Above>
					{(["a", "b", "c"] as const).map((id) => (
						<Probe
							key={id}
							session={host.renderer.kernelSdk.domains
								.get(Sessions)!
								.getState()
								.sessions.find((s) => s.id === id)!}
						/>
					))}
				</Above>
			</KernelProvider>
		);
		render(probes);

		const busy = page.getByTestId("probe-a");
		await expect.element(busy.getByRole("status", { name: "Working" })).toBeVisible();
		await expect.element(busy.getByTestId("session-status")).toHaveTextContent("Working");
		await expect.element(busy.getByTestId("badge-a")).toBeVisible();
		await expect
			.element(page.getByTestId("probe-b").getByTestId("session-status"))
			.toHaveTextContent("Archived");
		await expect
			.element(page.getByTestId("probe-c").getByTestId("session-status"))
			.toHaveTextContent("Idle");

		await busy.getByRole("button", { name: "Card menu" }).click();
		await page.getByTestId("session-menu-rename").click();
		expect(rename).toHaveBeenCalled();
		await busy.getByRole("button", { name: "Card menu" }).click();
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledWith("a", true));

		await page.getByTestId("probe-c").getByTestId("session-list-item-more").click();
		await expect.element(page.getByTestId("session-menu-pin")).toBeVisible();
		expect(page.getByTestId("session-menu-rename").elements()).toHaveLength(0);
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-confirm").click();
		await vi.waitFor(() => expect(sessions.calls.remove).toHaveBeenCalledWith("c"));
	});
});

describe("session rows", () => {
	it("drag the session as an object reference", async () => {
		await renderWorkbench({ sessions: [session("a", { title: "Fix login" })] });
		await expect.element(row("Fix login")).toBeVisible();
		const dataTransfer = new DataTransfer();

		row("Fix login")
			.element()
			.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true }));

		expect(JSON.parse(dataTransfer.getData(OBJECT_REFS_FORMAT))).toEqual([
			{ type: "kilo.sessions/session", id: "a" },
		]);
	});

	it("offer a menu item's choices as a submenu", async () => {
		const run = vi.fn();
		const chooser = {
			manifest: testManifest("test.chooser", {
				contributes: {
					extensions: { "kilo.sessions/session-menu": [{ id: "move", title: "Move to" }] },
				},
			}),
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(SessionMenu, "move", {
						run,
						choices: () => [
							{ id: "left", title: "Left", checked: true },
							{ id: "right", title: "Right" },
						],
					});
				},
			},
		};
		await renderWorkbench({ sessions: [session("a", { title: "Fix login" })], guests: [chooser] });

		await row("Fix login").hover();
		await row("Fix login").getByTestId("session-list-item-more").click();
		await page.getByTestId("session-menu-test.chooser/move").hover();
		await page.getByTestId("session-menu-test.chooser/move-right").click();

		await vi.waitFor(() =>
			expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "right"),
		);
	});
});
