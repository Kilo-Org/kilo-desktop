import { TerminalIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelWindowView, KernelWindows } from "@kilo-desktop/kernel";
import type { MainKernel, MainKernelHost } from "@kilo-desktop/kernel/main";
import { KernelProvider, RenderContribution, useDomainObject } from "@kilo-desktop/kernel/web";
import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";
import { render } from "@testing-library/react";

import {
	grantDataCollection,
	paneKindPlugin,
	panesOf,
	pane as paneRecord,
	renderWorkSessions,
	telemetrySink,
	workSession,
	workspace,
	type GuestPlugin,
} from "../../testing";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	type Pane,
	type PaneProps,
	type WorkSessionPanes,
} from "../../contracts";
import { LAYOUT_SAVE_DELAY_MS } from "./SessionCanvas";

const SESSION = workSession("wses_1", { title: "Fix login", workspaceId: "w-app" });
const APP = workspace("w-app", "App", {
	folders: [{ id: "f", path: "/projects/app", isPrimary: true, position: 0 }],
});

const canClose = vi.fn(async (_input: { workSessionId: string; pane: Pane }) => true);

const Terminal = ({ workSessionId, pane, directory, visible }: PaneProps) => (
	<div data-qa-id={`terminal-${pane.id}`}>
		{workSessionId} · {pane.title} · {directory} · {visible ? "visible" : "hidden"}
	</div>
);

/**
 * A plugin with a terminal pane kind, a sign-in gated one, one it doesn't
 * implement here, and an editor kind whose panes ask before closing.
 */
const panesPlugin = paneKindPlugin("test.panes", [
	{
		id: "terminal",
		metadata: { title: "Terminal", launch: { newSession: true, inSession: true } },
		component: Terminal,
		icon: ({ className, status }) => (
			<TerminalIcon className={className} data-icon-status={status ?? "none"} />
		),
	},
	{
		id: "notebook",
		metadata: {
			title: "Notebook",
			availableWhen: { all: ["test.panes/signedIn"] },
			unavailableHint: "Sign in to use notebooks",
		},
		component: () => <div>Notebook</div>,
	},
	{ id: "elsewhere", metadata: { title: "Elsewhere" } },
	{
		id: "guarded",
		metadata: { title: "Editor" },
		component: ({ pane }: PaneProps) => <div data-qa-id={`editor-${pane.id}`}>Editor</div>,
		canClose: (input) => canClose(input),
	},
]);

/** A singleton kind with its own button in the session header, kept out of tab groups' "+" (but not the header's). */
const pinnedPlugin = paneKindPlugin("test.pinned", [
	{
		id: "helper",
		metadata: {
			title: "Helper",
			launch: { inSession: true, sessionHeader: true, tabGroup: false },
			singleton: true,
		},
		component: () => <div>Helper</div>,
	},
]);

/** A pane whose button opens another pane, the way the files tree opens a file. */
function Opener({ workSessionId }: PaneProps) {
	const panes = useDomainObject(Panes);
	return (
		<button
			data-qa-id="open-another-pane"
			onClick={() => {
				void panes?.methods.open({
					workSessionId,
					kind: "test.opener/document",
					title: "opened",
				});
			}}
			type="button"
		>
			Open another pane
		</button>
	);
}

const openerPlugin = paneKindPlugin("test.opener", [
	{
		id: "explorer",
		metadata: { title: "Explorer", launch: { newSession: true, inSession: true } },
		component: Opener,
	},
	{
		id: "document",
		metadata: { title: "Document", launch: { newSession: true, inSession: true } },
		component: ({ pane }: PaneProps) => <div data-qa-id={`document-${pane.id}`}>{pane.id}</div>,
	},
]);

async function renderPanes(
	options: {
		panes?: Record<string, WorkSessionPanes>;
		open?: boolean;
		windows?: MainKernelHost["windows"];
		extraPlugins?: readonly GuestPlugin[];
		beforeRender?: (main: MainKernel) => void;
		clipboard?: boolean;
	} = {},
) {
	const rendered = await renderWorkSessions({
		...(options.clipboard === false ? { clipboard: false } : {}),
		workSessions: [SESSION],
		workspaces: [APP],
		activeWorkspaceId: APP.id,
		...(options.panes ? { panes: options.panes } : {}),
		...(options.open === false ? {} : { open: SESSION.id }),
		...(options.windows ? { windows: options.windows } : {}),
		...(options.beforeRender ? { beforeRender: options.beforeRender } : {}),
		guests: [panesPlugin, ...(options.extraPlugins ?? [])],
	});
	const state = () => rendered.panesState(SESSION.id);
	return { ...rendered, state };
}

const pane = (id: string, kind = "test.panes/terminal", title = id): Pane =>
	paneRecord(id, kind, { title });

const withPanes = (
	panes: Pane[],
	activePaneId = panes[0]?.id ?? null,
): Record<string, WorkSessionPanes> => ({
	[SESSION.id]: panesOf(panes, { activePaneId }),
});

describe("session panes", () => {
	it("opens a pane from the header, given the session, pane and working folder", async () => {
		const { calls } = await renderPanes();
		await expect.element(page.getByTestId("session-empty")).toBeVisible();

		await page.getByTestId("chat-pane-toolbar-add").click();
		await page.getByTestId("chat-pane-launch-test.panes/terminal").click();

		await vi.waitFor(() =>
			expect(calls.openPane).toHaveBeenCalledWith({
				workSessionId: SESSION.id,
				kind: "test.panes/terminal",
			}),
		);
		await expect
			.element(page.getByTestId(/^terminal-pane_/))
			.toHaveTextContent("wses_1 · Terminal · /projects/app · visible");
	});

	it("adds a tab group from the header '+', beside the active one", async () => {
		const { state } = await renderPanes({ panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-toolbar-add").click();
		await page.getByTestId("chat-pane-launch-test.panes/terminal").click();

		await vi.waitFor(() => {
			const layout = parseLayoutJson(state()?.layout);
			expect(layout?.groups.map((group) => group.tabs.length)).toEqual([1, 1]);
			expect(layout?.groups[0]?.tabs[0]?.id).toBe("a");
		});
	});

	it("keeps a pane opened by a click in another pane active once its activation save settles", async () => {
		const { state } = await renderPanes({
			panes: withPanes(
				[
					pane("explorer", "test.opener/explorer"),
					pane("viewer", "test.opener/document", "viewer"),
				],
				"viewer",
			),
			extraPlugins: [openerPlugin],
		});
		const open = page.getByTestId("open-another-pane");
		await expect.element(open).toBeVisible();

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			await open.click();
			await vi.waitFor(() => expect(state()?.panes).toHaveLength(3));
			const opened = state()?.panes.at(-1)?.id;
			expect(state()?.activePaneId).toBe(opened);

			// The pointerdown that focused the clicked pane queued a layout save; it
			// must not write back the active pane the open has since moved on from.
			await vi.advanceTimersByTimeAsync(LAYOUT_SAVE_DELAY_MS + 1);
			expect(state()?.activePaneId).toBe(opened);
			expect(state()?.panes).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lists a gated kind as unavailable, with why", async () => {
		await renderPanes({ panes: withPanes([pane("a")]) });

		await page.getByTestId("chat-pane-toolbar-add").click();

		await expect
			.element(page.getByTestId("chat-pane-launch-test.panes/notebook"))
			.toHaveAttribute("aria-description", "Sign in to use notebooks");
		await expect
			.element(page.getByTestId("chat-pane-launch-test.panes/elsewhere"))
			.not.toBeInTheDocument();
	});

	it("puts kinds pinned to the header after '+', which still offers them, and before the carousel", async () => {
		const { calls } = await renderPanes({
			panes: withPanes([pane("a")]),
			extraPlugins: [pinnedPlugin],
		});

		const add = page.getByTestId("chat-pane-toolbar-add");
		const pinned = page.getByTestId("chat-pane-pinned-test.pinned/helper");
		const carousel = page.getByTestId("chat-pane-arrangement");
		await expect.element(pinned).toHaveAccessibleName("Helper");
		const follows = (a: Element, b: Element) =>
			Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		expect(follows(add.element(), pinned.element())).toBe(true);
		expect(follows(pinned.element(), carousel.element())).toBe(true);

		await add.click();
		await expect
			.element(page.getByTestId("chat-pane-launch-test.panes/terminal"))
			.toBeInTheDocument();
		await expect
			.element(page.getByTestId("chat-pane-launch-test.pinned/helper"))
			.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		await pinned.click();
		await vi.waitFor(() =>
			expect(calls.openPane).toHaveBeenCalledWith({
				workSessionId: SESSION.id,
				kind: "test.pinned/helper",
			}),
		);
	});

	it("leaves kinds that opt out of tab groups out of a group's '+'", async () => {
		await renderPanes({ panes: withPanes([pane("a")]), extraPlugins: [pinnedPlugin] });

		// Moves the pointer off the header, where a tooltip would cover the group's "+".
		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-add-tab").click();

		await expect
			.element(page.getByTestId("chat-pane-add-menu-test.panes/terminal"))
			.toBeInTheDocument();
		await expect
			.element(page.getByTestId("chat-pane-add-menu-test.pinned/helper"))
			.not.toBeInTheDocument();
	});

	it("puts pane islands straight on the window, without the shell's card around them", async () => {
		const frame = () => getComputedStyle(page.getByTestId("shell-main").element());
		await renderPanes();
		await expect.element(page.getByTestId("session-empty")).toBeVisible();
		// The card is inset from the window edge and scrolls its content.
		expect(frame().marginLeft).not.toBe("0px");
		expect(frame().overflowY).toBe("auto");

		await renderPanes({ panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("session-canvas")).toBeVisible();
		expect(frame().marginLeft).toBe("0px");
		expect(frame().overflowY).toBe("visible");
	});

	it("brings the shell's card back on the New Session page while a left work session stays mounted", async () => {
		const other = workSession("wses_2", { title: "Other", workspaceId: APP.id });
		const frame = () => getComputedStyle(page.getByTestId("shell-main").element());
		const { window } = await renderWorkSessions({
			workSessions: [SESSION, other],
			workspaces: [APP],
			activeWorkspaceId: APP.id,
			panes: { ...withPanes([pane("a")]), [other.id]: panesOf([pane("b")]) },
			open: SESSION.id,
			guests: [panesPlugin],
		});
		await expect.element(page.getByTestId("session-canvas")).toBeVisible();

		// Leaving SESSION for another keeps it mounted (hidden); closing that one shows the New Session page.
		await window().methods.openWorkSession({ workSessionId: other.id });
		await window().methods.closeWorkSession(undefined);

		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
		expect(page.getByTestId("session-canvas").elements()).toHaveLength(1);
		expect(frame().marginLeft).not.toBe("0px");
		expect(frame().overflowY).toBe("auto");
	});

	it("shows a pane whose plugin isn't here as unavailable", async () => {
		await renderPanes({ panes: withPanes([pane("x", "gone.plugin/thing", "Old pane")]) });

		await expect.element(page.getByText("Old pane isn't available")).toBeVisible();
	});

	it("closes panes from their tab, back to the empty session", async () => {
		const { calls } = await renderPanes({ panes: withPanes([pane("a")]) });

		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-close-tab-a").click();

		await vi.waitFor(() => expect(calls.closePane).toHaveBeenCalledWith("a"));
		await expect.element(page.getByTestId("session-empty")).toBeVisible();
	});

	it("unmounts hidden panes of kinds that aren't kept alive", async () => {
		const { run, state } = await renderPanes({
			panes: {
				[SESSION.id]: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [pane("a"), pane("b")],
					activePaneId: "a",
					layout: JSON.stringify({
						groups: [
							{
								id: "g",
								tabs: [
									{ id: "a", kind: "tool", title: "a" },
									{ id: "b", kind: "tool", title: "b" },
								],
								activePaneId: "a",
								preferredWidth: 360,
								minWidth: 240,
								pinned: false,
							},
						],
						activePaneId: "a",
						sizes: {},
					}),
				},
			},
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		expect(page.getByTestId("terminal-b").elements()).toHaveLength(0);

		await run("next-pane");

		await vi.waitFor(() => expect(state()?.activePaneId).toBe("b"));
		await vi.waitFor(() =>
			expect(page.getByTestId("terminal-b").elements()[0]?.textContent).toContain("visible"),
		);
		expect(page.getByTestId("terminal-a").elements()).toHaveLength(0);
	});
});

describe("closing a pane whose kind asks first", () => {
	it("keeps it open when its kind says no, from the tab and the command", async () => {
		canClose.mockResolvedValue(false);
		const { run, calls } = await renderPanes({
			panes: withPanes([pane("e", "test.panes/guarded", "notes.md")]),
		});
		await expect.element(page.getByTestId("editor-e")).toBeVisible();

		await page.getByTestId("chat-pane-tab-e").hover();
		await page.getByTestId("chat-pane-close-tab-e").click();
		await vi.waitFor(() =>
			expect(canClose).toHaveBeenCalledWith({
				workSessionId: SESSION.id,
				pane: expect.objectContaining({ id: "e" }),
			}),
		);
		await run("close-pane");
		await vi.waitFor(() => expect(canClose).toHaveBeenCalledTimes(2));

		expect(calls.closePane).not.toHaveBeenCalled();
		await expect.element(page.getByTestId("editor-e")).toBeVisible();
	});

	it("closes it once its kind agrees, or when the question fails", async () => {
		canClose.mockReset();
		canClose.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("broken"));
		const { run, calls } = await renderPanes({
			panes: withPanes([
				pane("e", "test.panes/guarded", "notes.md"),
				pane("f", "test.panes/guarded", "todo.md"),
			]),
		});
		await expect.element(page.getByTestId("editor-e")).toBeVisible();

		await run("close-pane");
		await vi.waitFor(() => expect(calls.closePane).toHaveBeenCalledWith("e"));
		await run("close-pane");
		await vi.waitFor(() => expect(calls.closePane).toHaveBeenCalledWith("f"));
		expect(canClose).toHaveBeenCalledTimes(2);
	});
});

describe("tab commands", () => {
	it("moves between tabs, closes the active one and toggles the carousel", async () => {
		const { run, state, calls } = await renderPanes({
			panes: withPanes([pane("a"), pane("b"), pane("c")]),
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("next-pane");
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("b"));
		await run("previous-pane");
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("a"));
		await run("pane-last");
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("c"));
		await run("pane-1");
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("a"));

		await run("close-pane");
		await vi.waitFor(() => expect(calls.closePane).toHaveBeenCalledWith("a"));

		await run("toggle-carousel");
		await vi.waitFor(() => expect(calls.setArrangement).toHaveBeenCalledWith("carousel"));
		await expect
			.element(page.getByTestId("chat-pane-arrangement"))
			.toHaveAttribute("aria-pressed", "true");
	});

	it("opens a new tab from the picker, or a new group beside the active one", async () => {
		const { run, state, calls } = await renderPanes({ panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("new-pane");
		await page.getByTestId("new-pane-picker-test.panes/terminal").click();
		await vi.waitFor(() => expect(state()?.panes).toHaveLength(2));
		// Main places it in the active group (panes.test.ts).
		expect(calls.openPane).toHaveBeenCalledWith(expect.objectContaining({ placement: "tab" }));

		await run("new-group-below");
		await page.getByTestId("new-pane-picker-test.panes/terminal").click();
		await vi.waitFor(() => {
			const layout = parseLayoutJson(state()?.layout);
			expect(layout && flattenPanes(layout)).toHaveLength(3);
			expect(layout?.groups.some((group) => group.stackId !== undefined)).toBe(true);
		});
	});

	it("opens a tab from a group's '+' straight into that group", async () => {
		const { calls } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]) });
		const tabB = page.getByTestId("chat-pane-tab-b");
		await expect.element(tabB).toBeVisible();
		const groupB = tabB.element().closest<HTMLElement>("[data-pane-group-id]")!;

		await tabB.hover();
		groupB.querySelector<HTMLElement>("[data-qa-id='chat-pane-add-tab']")!.click();
		await page.getByTestId("chat-pane-add-menu-test.panes/terminal").click();

		// Main places it in the write that opens it (panes.test.ts), so it never shows in a column of its own.
		await vi.waitFor(() =>
			expect(calls.openPane).toHaveBeenCalledWith({
				workSessionId: SESSION.id,
				kind: "test.panes/terminal",
				placement: "tab",
				groupId: groupB.dataset.paneGroupId,
			}),
		);
	});

	it("saves layout changes made on the canvas", async () => {
		const { calls } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-tab-b").click();

		await vi.waitFor(() => expect(calls.setLayout).toHaveBeenCalled());
		expect(parseLayoutJson(calls.setLayout.mock.lastCall?.[0])?.activePaneId).toBe("b");
	});
});

describe("pop-out panes", () => {
	function hostWindows() {
		return {
			open: vi.fn(async () => "w9"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
		};
	}

	it("pops a pane out, brings it forward or docks it, and hides it with its session", async () => {
		const windows = hostWindows();
		const { host, calls, window } = await renderPanes({
			panes: withPanes([pane("a"), pane("b")]),
			windows,
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-pop-out-tab-a").click();
		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					view: "kilo.work-sessions/pane",
					title: "a",
					params: { workSessionId: SESSION.id, paneId: "a" },
				}),
			),
		);
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.work-sessions/pane" });
		await expect.element(page.getByTestId("chat-pane-popped-out-a")).toBeVisible();

		await page
			.getByTestId("chat-pane-popped-out-a")
			.getByRole("button", { name: "Bring to front" })
			.click();
		expect(windows.focus).toHaveBeenCalledWith("w9");

		await window().methods.closeWorkSession(undefined);
		await vi.waitFor(() => expect(windows.setHidden).toHaveBeenCalledWith("w9", true));
		await window().methods.openWorkSession({ workSessionId: SESSION.id });
		await vi.waitFor(() => expect(windows.setHidden).toHaveBeenLastCalledWith("w9", false));

		await page.getByTestId("chat-pane-popped-out-a").getByRole("button", { name: "Dock" }).click();
		expect(windows.close).toHaveBeenCalledWith("w9");
		host.main.windowEvents.closed("w9");
		await vi.waitFor(() => expect(calls.activatePane).toHaveBeenCalledWith("a"));
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
	});

	it("closes a pop-out whose pane was closed", async () => {
		const windows = hostWindows();
		const { host } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]), windows });
		await host.renderer.kernelSdk.domainObjects.get(KernelWindows)!.methods.open({
			view: "kilo.work-sessions/pane",
			key: `${SESSION.id}/b`,
			params: { workSessionId: SESSION.id, paneId: "b" },
		});
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.work-sessions/pane" });

		await host.renderer.kernelSdk.domainObjects
			.get(Panes)!
			.methods.close({ workSessionId: SESSION.id, paneId: "b" });

		await vi.waitFor(() => expect(windows.close).toHaveBeenCalledWith("w9"));
	});

	it("shows the pane in its window, with a Dock button that closes the window", async () => {
		const { host } = await renderPanes({ panes: withPanes([pane("a")]), windows: hostWindows() });
		const view = host.renderer.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.work-sessions/pane")!;
		const windowView = (params: Record<string, string>) => (
			<KernelProvider kernel={host.renderer}>
				<RenderContribution contribution={view} props={{ params }} />
			</KernelProvider>
		);
		const shown = render(windowView({ workSessionId: SESSION.id, paneId: "a" }));

		const header = page.getByTestId("pane-window-header");
		await expect.element(header.getByText("Fix login")).toBeVisible();
		await expect.element(page.getByTestId("pane-window").getByTestId("terminal-a")).toBeVisible();
		shown.unmount();

		render(windowView({ workSessionId: SESSION.id, paneId: "gone" }));
		await expect.element(page.getByTestId("pane-window-gone")).toBeVisible();
	});
});

describe("layout telemetry", () => {
	it("reports arrangement changes from the header and the command", async () => {
		const sink = telemetrySink();
		const { run } = await renderPanes({
			panes: withPanes([pane("a")]),
			extraPlugins: [sink.plugin],
			beforeRender: grantDataCollection,
		});

		await page.getByTestId("chat-pane-arrangement").click();
		await vi.waitFor(() =>
			expect(sink.events("layout-arrangement-changed")).toEqual([{ arrangement: "carousel" }]),
		);
		await run("toggle-carousel");
		await vi.waitFor(() =>
			expect(sink.events("layout-arrangement-changed")).toEqual([
				{ arrangement: "carousel" },
				{ arrangement: "tiles" },
			]),
		);
	});
});

describe("WorkSessionsWindow.openPane (for other plugins' commands)", () => {
	it("opens the kind once, then shows the pane it already has", async () => {
		const { window, state, calls } = await renderPanes({
			panes: withPanes([pane("a"), pane("g", "test.panes/guarded", "notes.md")], "g"),
			extraPlugins: [pinnedPlugin],
		});
		await expect.element(page.getByTestId("editor-g")).toBeVisible();

		await window().methods.openPane({ kind: "test.panes/terminal" });
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("a"));
		expect(calls.openPane).not.toHaveBeenCalled();

		await window().methods.openPane({ kind: "test.pinned/helper" });
		await vi.waitFor(() =>
			expect(calls.openPane).toHaveBeenCalledWith({
				workSessionId: SESSION.id,
				kind: "test.pinned/helper",
				placement: "tab",
			}),
		);
		expect(calls.openPane).toHaveBeenCalledTimes(1);
	});

	it("opens the kind in a new tab group beside the active one when asked, as the header '+' does", async () => {
		const { window, state } = await renderPanes({
			panes: withPanes([pane("a")]),
			extraPlugins: [pinnedPlugin],
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await window().methods.openPane({ kind: "test.pinned/helper", placement: "group" });

		await vi.waitFor(() => {
			const layout = parseLayoutJson(state()?.layout);
			expect(layout?.groups.map((group) => group.tabs.length)).toEqual([1, 1]);
			expect(layout?.groups[0]?.tabs[0]?.id).toBe("a");
		});
	});

	it("does nothing with no session open", async () => {
		const { window, calls } = await renderPanes({ panes: withPanes([pane("a")]) });
		await window().methods.closeWorkSession(undefined);

		await window().methods.openPane({ kind: "test.pinned/helper" });

		expect(calls.openPane).not.toHaveBeenCalled();
	});

	it("brings a popped-out pane's window forward", async () => {
		const windows = {
			open: vi.fn(async () => "w9"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
		};
		const { host, window } = await renderPanes({ panes: withPanes([pane("a")]), windows });
		await host.renderer.kernelSdk.domainObjects.get(KernelWindows)!.methods.open({
			view: "kilo.work-sessions/pane",
			key: `${SESSION.id}/a`,
			params: { workSessionId: SESSION.id, paneId: "a" },
		});
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.work-sessions/pane" });
		await expect.element(page.getByTestId("chat-pane-popped-out-a")).toBeVisible();

		await window().methods.openPane({ kind: "test.panes/terminal" });

		await vi.waitFor(() => expect(windows.focus).toHaveBeenCalledWith("w9"));
	});
});

describe("without pane kinds", () => {
	it("says no plugin adds panes yet, and offers no '+'", async () => {
		await renderWorkSessions({ workSessions: [SESSION], open: SESSION.id });

		await expect
			.element(
				page
					.getByTestId("session-empty")
					.getByText("No installed plugin adds panes to sessions yet."),
			)
			.toBeVisible();
		await expect.element(page.getByTestId("chat-pane-toolbar-add")).not.toBeInTheDocument();
	});

	it("still shows a saved pane, as unavailable", async () => {
		await renderWorkSessions({
			workSessions: [SESSION],
			open: SESSION.id,
			panes: withPanes([pane("x", "gone.plugin/thing", "Old pane")]),
		});

		await expect.element(page.getByTestId("pane-unavailable")).toBeVisible();
	});
});

/** A column's group, or one group of a stacked column (`stack` names the column). */
type GroupSpec = readonly string[] | { readonly tabs: readonly string[]; readonly stack: string };

/** Terminal panes arranged in these groups, left to right (stacked groups top to bottom). */
function arranged(
	groups: readonly GroupSpec[],
	activePaneId: string,
	kinds: Readonly<Record<string, string>> = {},
): Record<string, WorkSessionPanes> {
	const specs = groups.map((spec) => ("tabs" in spec ? spec : { tabs: spec, stack: undefined }));
	const layout = {
		groups: specs.map(({ tabs, stack }, index) => ({
			id: `g${index}`,
			tabs: tabs.map((id) => ({ id, kind: "tool", title: id })),
			activePaneId: tabs.includes(activePaneId) ? activePaneId : tabs[0],
			preferredWidth: 360,
			minWidth: 240,
			pinned: false,
			...(stack ? { stackId: stack } : {}),
		})),
		activePaneId,
		sizes: {},
	};
	return {
		[SESSION.id]: panesOf(
			specs.flatMap(({ tabs }) => tabs.map((id) => pane(id, kinds[id]))),
			{ activePaneId, layout: JSON.stringify(layout) },
		),
	};
}

/** The saved layout's tab ids per group. */
const groupsOf = (state: WorkSessionPanes | undefined) =>
	parseLayoutJson(state?.layout)?.groups.map((group) => group.tabs.map((tab) => tab.id));

const openTabMenu = async (paneId: string) => {
	await page.getByTestId(`chat-pane-tab-${paneId}`).click({ button: "right" });
	await expect.element(page.getByTestId("pane-tab-menu-close")).toBeVisible();
};

describe("tab context menu", () => {
	it("opens on a tab without showing it, and closes that tab", async () => {
		const { state, calls } = await renderPanes({ panes: arranged([["a", "b"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await openTabMenu("b");
		expect(state().activePaneId).toBe("a");
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("pane-tab-menu-close").click();
		await vi.waitFor(() => expect(calls.closePane).toHaveBeenCalledWith("b"));
		expect(state().panes.map((entry) => entry.id)).toEqual(["a"]);
	});

	it("closes the other tabs, the tabs to the right or every tab of the tab's group only", async () => {
		const { run, state } = await renderPanes({
			panes: arranged([["a", "b", "c", "d"], ["x"]], "a"),
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		const open = () => state().panes.map((entry) => entry.id);

		await run("close-panes-to-the-right", { paneId: "c" });
		await vi.waitFor(() => expect(open()).toEqual(["a", "b", "c", "x"]));
		await run("close-other-panes", { paneId: "b" });
		await vi.waitFor(() => expect(open()).toEqual(["b", "x"]));
		await run("close-all-panes", { paneId: "b" });
		await vi.waitFor(() => expect(open()).toEqual(["x"]));
	});

	it("closes among the tabs the strip shows, which may not be saved yet", async () => {
		const { run, state } = await renderPanes({ panes: arranged([["a", "b", "c", "d"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		const open = () => state().panes.map((entry) => entry.id);

		// The strip shows b's group as [b, c] (a move not saved yet).
		await run("close-other-panes", { paneId: "b", groupPaneIds: ["b", "c"] });
		await vi.waitFor(() => expect(open()).toEqual(["a", "b", "d"]));
		// Ids no longer open are ignored.
		await run("close-panes-to-the-right", { paneId: "b", groupPaneIds: ["b", "gone", "d"] });
		await vi.waitFor(() => expect(open()).toEqual(["a", "b"]));
	});

	it("closes by the saved layout when the shown group doesn't hold the tab", async () => {
		const { run, state } = await renderPanes({ panes: arranged([["a", "b", "c"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("close-other-panes", { paneId: "b", groupPaneIds: ["a", "c"] });

		await vi.waitFor(() => expect(state().panes.map((entry) => entry.id)).toEqual(["b"]));
	});

	it("acts on the active tab when given none", async () => {
		const { run, state } = await renderPanes({ panes: arranged([["a", "b", "c"]], "b") });
		await expect.element(page.getByTestId("terminal-b")).toBeVisible();

		await run("close-other-panes");

		await vi.waitFor(() => expect(state().panes.map((entry) => entry.id)).toEqual(["b"]));
	});

	it("skips tabs whose kind keeps them open, closing the rest", async () => {
		canClose.mockReset();
		canClose.mockResolvedValue(false);
		const { run, state } = await renderPanes({
			panes: arranged([["a", "e", "b"]], "a", { e: "test.panes/guarded" }),
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("close-all-panes", { paneId: "a" });

		await vi.waitFor(() => expect(state().panes.map((entry) => entry.id)).toEqual(["e"]));
		expect(canClose).toHaveBeenCalledTimes(1);
	});

	it("keeps closing after one close fails, saying how many failed", async () => {
		const { run, state, main } = await renderPanes({ panes: arranged([["a", "b", "c"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		main.failNextWith("disk full");

		await run("close-all-panes", { paneId: "b" });

		await vi.waitFor(() => expect(state().panes.map((entry) => entry.id)).toEqual(["a"]));
		await expect.element(page.getByText("Could not close 1 tab")).toBeVisible();
	});

	it("disables closing others in a lone tab's group and closing to the right on the last tab", async () => {
		await renderPanes({ panes: arranged([["a", "b"], ["x"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await openTabMenu("a");
		await expect.element(page.getByTestId("pane-tab-menu-close-others")).toBeEnabled();
		await expect.element(page.getByTestId("pane-tab-menu-close-right")).toBeEnabled();
		await userEvent.keyboard("{Escape}");

		await openTabMenu("b");
		await expect.element(page.getByTestId("pane-tab-menu-close-right")).toBeDisabled();
		await userEvent.keyboard("{Escape}");

		await openTabMenu("x");
		await expect.element(page.getByTestId("pane-tab-menu-close-others")).toBeDisabled();
		await expect.element(page.getByTestId("pane-tab-menu-close-all")).toBeEnabled();
	});
});

describe("moving a tab", () => {
	it("moves into the neighbouring group, or splits toward an edge with none", async () => {
		const { run, state } = await renderPanes({ panes: arranged([["a", "b"], ["x"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		const content = page.getByTestId("terminal-a").element();

		await run("move-pane-right", { paneId: "a" });
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["b"], ["x", "a"]]));
		await run("move-pane-left", { paneId: "x" });
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["b", "x"], ["a"]]));
		await run("move-pane-up", { paneId: "b" });
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["b"], ["x"], ["a"]]));
		await run("move-pane-down", { paneId: "b" });
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["x", "b"], ["a"]]));

		// Moved, not remounted.
		expect(page.getByTestId("terminal-a").element()).toBe(content);
	});

	it("moves the active tab when given none, splitting it off from the menu too", async () => {
		const { run, state } = await renderPanes({ panes: arranged([["a", "b"]], "b") });
		await expect.element(page.getByTestId("terminal-b")).toBeVisible();

		await run("move-pane-left");
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["b"], ["a"]]));

		await openTabMenu("b");
		await page.getByTestId("pane-tab-menu-move").click();
		await page.getByTestId("pane-tab-menu-move-right").click();
		await vi.waitFor(() => expect(groupsOf(state())).toEqual([["a", "b"]]));
	});

	it("does nothing when the move would change nothing", async () => {
		const { run, calls } = await renderPanes({ panes: arranged([["a"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		for (const direction of ["up", "down", "left", "right"]) {
			await run(`move-pane-${direction}`, { paneId: "a" });
		}
		await run("move-pane-left", { paneId: "gone" });

		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(calls.setLayout).not.toHaveBeenCalled();
	});
});

describe("moving a tab into a new window", () => {
	const hostWindows = () => ({
		open: vi.fn(async () => "w9"),
		focus: vi.fn(),
		close: vi.fn(),
		setHidden: vi.fn(),
		focusMain: vi.fn(),
	});

	it("pops the tab out from the menu, which offers it only where windows can open", async () => {
		await renderPanes({ panes: arranged([["a", "b"]], "a") });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		await openTabMenu("b");
		await expect.element(page.getByTestId("pane-tab-menu-move-new-window")).not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		const windows = hostWindows();
		await renderPanes({ panes: arranged([["a", "b"]], "a"), windows });
		await openTabMenu("b");
		await page.getByTestId("pane-tab-menu-move-new-window").click();

		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					view: "kilo.work-sessions/pane",
					params: { workSessionId: SESSION.id, paneId: "b" },
				}),
			),
		);
	});

	it("brings a popped-out tab's window forward, and leaves it where it is when moved", async () => {
		const windows = hostWindows();
		const { host, run, calls } = await renderPanes({
			panes: arranged([["a", "b"], ["x"]], "a"),
			windows,
		});
		await host.renderer.kernelSdk.domainObjects.get(KernelWindows)!.methods.open({
			view: "kilo.work-sessions/pane",
			key: `${SESSION.id}/b`,
			params: { workSessionId: SESSION.id, paneId: "b" },
		});
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.work-sessions/pane" });
		await expect
			.element(page.getByTestId("chat-pane-tab-b"))
			.toHaveAttribute("data-popped-out", "true");

		await run("move-pane-to-new-window", { paneId: "b" });
		await vi.waitFor(() => expect(windows.focus).toHaveBeenCalledWith("w9"));
		expect(windows.open).toHaveBeenCalledTimes(1);

		await run("move-pane-right", { paneId: "b" });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(calls.setLayout).not.toHaveBeenCalled();
	});
});

describe("copying a tab's path", () => {
	/** A kind that names its panes' files from metadata, as Notebook does. */
	const notesPlugin = paneKindPlugin("test.notes", [
		{
			id: "note",
			metadata: { title: "Note" },
			component: ({ pane }: PaneProps) => <div data-qa-id={`note-${pane.id}`}>{pane.id}</div>,
			path: (pane) => pane.metadata["file"],
		},
	]);
	const file = (id: string, path: string): Pane =>
		paneRecord(id, "test.panes/terminal", {
			title: id,
			object: { type: "kilo.work-sessions/file", id: path },
		});
	const note = (id: string, path: string): Pane =>
		paneRecord(id, "test.notes/note", { title: id, metadata: { file: path } });

	it("copies the file's absolute path, or its path inside the session folder holding it", async () => {
		const { run, copied } = await renderPanes({
			panes: withPanes([file("a", "/projects/app/src/a.ts"), note("n", "/elsewhere/notes.md")]),
			extraPlugins: [notesPlugin],
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("copy-pane-path", { paneId: "a" });
		await run("copy-pane-relative-path", { paneId: "a" });
		await run("copy-pane-relative-path", { paneId: "n" });

		await vi.waitFor(() =>
			expect(copied).toEqual(["/projects/app/src/a.ts", "src/a.ts", "/elsewhere/notes.md"]),
		);
	});

	it("copies from the tab menu, which offers copying only for a tab showing a file", async () => {
		const { copied } = await renderPanes({
			panes: withPanes([file("a", "/projects/app/src/a.ts"), pane("t")]),
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await openTabMenu("t");
		await expect.element(page.getByTestId("pane-tab-menu-copy-path")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("pane-tab-menu-copy-relative-path"))
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		await openTabMenu("a");
		await page.getByTestId("pane-tab-menu-copy-relative-path").click();
		await vi.waitFor(() => expect(copied).toEqual(["src/a.ts"]));
	});

	it("says so when no clipboard is available", async () => {
		const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
		Object.defineProperty(globalThis.navigator, "clipboard", {
			value: undefined,
			configurable: true,
		});
		try {
			const { run } = await renderPanes({
				panes: withPanes([file("a", "/projects/app/src/a.ts")]),
				clipboard: false,
			});
			await expect.element(page.getByTestId("terminal-a")).toBeVisible();

			await run("copy-pane-path", { paneId: "a" });

			await expect.element(page.getByText("Could not copy the path")).toBeVisible();
		} finally {
			if (original) Object.defineProperty(globalThis.navigator, "clipboard", original);
			else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
		}
	});

	it("copies nothing for a tab without a file", async () => {
		const { run, copied } = await renderPanes({ panes: withPanes([pane("t")]) });
		await expect.element(page.getByTestId("terminal-t")).toBeVisible();

		await run("copy-pane-path", { paneId: "t" });
		await run("copy-pane-relative-path");

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(copied).toEqual([]);
	});
});

describe("pane status", () => {
	it("badges a tab while its pane works or waits for the person", async () => {
		const { host } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
		expect(page.getByTestId("chat-pane-tab-status-a").elements()).toHaveLength(0);
		const panes = host.renderer.kernelSdk.domainObjects.get(Panes)!;

		await panes.methods.update({ workSessionId: SESSION.id, paneId: "a", status: "busy" });
		await expect
			.element(page.getByTestId("chat-pane-tab-status-a"))
			.toHaveAttribute("data-status", "busy");
		await panes.methods.update({ workSessionId: SESSION.id, paneId: "b", status: "attention" });
		await expect.element(page.getByRole("status", { name: "Needs your attention" })).toBeVisible();
		// The kind's icon is told the status, so it can change its shape.
		expect(
			page.getByTestId("chat-pane-tab-status-b").element().querySelector("svg"),
		).toHaveAttribute("data-icon-status", "attention");

		await panes.methods.update({ workSessionId: SESSION.id, paneId: "b", status: "unread" });
		await expect.element(page.getByRole("status", { name: "Unread" })).toBeVisible();

		await panes.methods.update({ workSessionId: SESSION.id, paneId: "a", status: null });
		await expect.element(page.getByTestId("chat-pane-tab-status-a")).not.toBeInTheDocument();
	});
});
