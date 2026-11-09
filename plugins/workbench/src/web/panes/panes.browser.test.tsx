import { TerminalIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	KernelWindowView,
	KernelWindows,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import type { MainKernelHost } from "@kilo-desktop/kernel/main";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import { render } from "@testing-library/react";
import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneProps,
	type WorkSession,
	type WorkSessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../../plugin.json";
import { fakeTelemetry } from "../../test/telemetry";
import { Workbench, WORKBENCH_DEFINITIONS } from "../../contracts";
import { workbenchWebEntry } from "../index";

const SESSION: WorkSession = {
	id: "wses_1",
	title: "Fix login",
	titleSource: "user",
	pinned: false,
	archived: false,
	archiveChangedAt: 0,
	workspaceId: "w-app",
	worktreeBranch: null,
	directory: null,
	chatIds: [],
	createdAt: 1,
	updatedAt: 1,
};

const APP: Workspace = {
	id: "w-app",
	name: "App",
	folders: [{ id: "f", path: "/projects/app", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

/** kilo.sessions' main, with panes kept in memory. */
function fakeSessionsMain(initialPanes: Record<string, WorkSessionPanes>) {
	const calls = {
		open: vi.fn(),
		close: vi.fn(),
		activate: vi.fn(),
		setLayout: vi.fn(),
		setArrangement: vi.fn(),
	};
	let next = 0;
	const entry: PluginEntry = {
		activate(sdk) {
			const sessions: DomainProvider<typeof WorkSessions> = sdk.domains.provide(WorkSessions, {
				initialState: { sessions: [SESSION] },
				methods: {
					create: () => {
						const created = { ...SESSION, id: `wses_new_${++next}`, title: "New session" };
						sessions.setState({ sessions: [...sessions.state.sessions, created] });
						return created;
					},
					rename: () => SESSION,
					setPinned: () => SESSION,
					setArchived: () => SESSION,
					setWorktreeBranch: () => SESSION,
					remove: () => ({ deleted: false }),
					importLegacyPins: () => undefined,
					isolationOptions: () => null,
				},
			});
			const panes: DomainProvider<typeof Panes> = sdk.domains.provide(Panes, {
				initialState: { bySession: initialPanes },
				methods: {
					open: (input) => {
						calls.open(input);
						const current = of(input.sessionId);
						const pane: Pane = {
							id: `pane_${++next}`,
							kind: input.kind,
							title: input.title ?? "Terminal",
							metadata: input.metadata ?? {},
							ordinal: 1,
						};
						write(input.sessionId, {
							...current,
							panes: [...current.panes, pane],
							activePaneId: pane.id,
						});
						return pane;
					},
					openObject: () => null,
					activate: ({ sessionId, paneId }) => {
						calls.activate(paneId);
						write(sessionId, { ...of(sessionId), activePaneId: paneId });
					},
					update: () => {
						throw new Error("unused");
					},
					close: ({ sessionId, paneId }) => {
						calls.close(paneId);
						const current = of(sessionId);
						const rest = current.panes.filter((pane) => pane.id !== paneId);
						write(sessionId, { ...current, panes: rest, activePaneId: rest[0]?.id ?? null });
						return { closed: true };
					},
					setLayout: ({ sessionId, layout, activePaneId }) => {
						calls.setLayout(layout);
						write(sessionId, {
							...of(sessionId),
							layout,
							...(activePaneId !== undefined ? { activePaneId } : {}),
						});
					},
					setArrangement: ({ sessionId, arrangement }) => {
						calls.setArrangement(arrangement);
						write(sessionId, { ...of(sessionId), arrangement });
					},
					importLegacy: () => undefined,
				},
			});
			const of = (sessionId: string) =>
				panes.state.bySession[sessionId] ?? EMPTY_WORK_SESSION_PANES;
			function write(sessionId: string, state: WorkSessionPanes) {
				panes.setState({ bySession: { ...panes.state.bySession, [sessionId]: state } });
			}
		},
	};
	return { entry, calls };
}

function fakeWorkspacesMain(): PluginEntry {
	return {
		activate(sdk) {
			sdk.domains.provide(Workspaces, {
				initialState: { workspaces: [APP], activeId: "w-app", unavailableFolderIds: [] },
				methods: {
					create: () => APP,
					update: () => APP,
					remove: () => ({ deleted: false }),
					setActive: () => undefined,
					authorize: () => ({ allowed: false }),
					checkFolders: () => undefined,
				},
			});
		},
	};
}

const canClose = vi.fn(async (_input: { sessionId: string; pane: Pane }) => true);

/**
 * A plugin with a terminal pane kind, a sign-in gated one, one it doesn't
 * implement here, and an editor kind whose panes ask before closing.
 */
const panesPlugin = {
	manifest: {
		manifestVersion: 1,
		id: "test.panes",
		displayName: "Panes",
		version: "1.0.0",
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{ id: "terminal", title: "Terminal", launch: { newSession: true, inSession: true } },
					{
						id: "notebook",
						title: "Notebook",
						availableWhen: { all: ["test.panes/signedIn"] },
						unavailableHint: "Sign in to use notebooks",
					},
					{ id: "elsewhere", title: "Elsewhere" },
					{ id: "guarded", title: "Editor" },
				],
			},
		},
	},
	web: {
		activate(sdk: PluginSdk) {
			const Terminal = ({ sessionId, pane, directory, visible }: PaneProps) => (
				<div data-qa-id={`terminal-${pane.id}`}>
					{sessionId} · {pane.title} · {directory} · {visible ? "visible" : "hidden"}
				</div>
			);
			sdk.extensions.implement(PaneKind, "terminal", { component: Terminal, icon: TerminalIcon });
			sdk.extensions.implement(PaneKind, "notebook", { component: () => <div>Notebook</div> });
			sdk.extensions.implement(PaneKind, "guarded", {
				component: ({ pane }: PaneProps) => <div data-qa-id={`editor-${pane.id}`}>Editor</div>,
				canClose: (input) => canClose(input),
			});
		},
	} satisfies PluginEntry,
};

/** A singleton kind with its own button in the session header, kept out of tab groups' "+". */
const pinnedPlugin: GuestPlugin = {
	manifest: {
		manifestVersion: 1,
		id: "test.pinned",
		displayName: "Pinned",
		version: "1.0.0",
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{
						id: "helper",
						title: "Helper",
						launch: { inSession: true, sessionHeader: true, tabGroup: false },
						singleton: true,
					},
				],
			},
		},
	},
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(PaneKind, "helper", { component: () => <div>Helper</div> });
		},
	} satisfies PluginEntry,
};

async function renderPanes(
	options: {
		panes?: Record<string, WorkSessionPanes>;
		open?: boolean;
		windows?: MainKernelHost["windows"];
		extraPlugins?: readonly GuestPlugin[];
	} = {},
) {
	const sessions = fakeSessionsMain(options.panes ?? {});
	const telemetry = fakeTelemetry();
	const host = await renderShell(
		[
			telemetry.plugin,
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, main: sessions.entry },
			{
				manifest: workspacesManifest,
				definitions: WORKSPACES_DEFINITIONS,
				main: fakeWorkspacesMain(),
			},
			{ manifest, definitions: WORKBENCH_DEFINITIONS, web: workbenchWebEntry },
			panesPlugin,
			...(options.extraPlugins ?? []),
		],
		{
			...(options.windows ? { desktop: true, windows: options.windows } : {}),
			...(options.open === false
				? {}
				: {
						localAppearance: {
							"kilo.workbench.navigator:main": JSON.stringify({
								focus: null,
								activeSessionId: SESSION.id,
							}),
						},
					}),
		},
	);
	const run = (command: string) => host.renderer.commands.execute(`kilo.workbench/${command}`);
	const state = () => host.renderer.kernelSdk.domains.get(Panes)!.getState().bySession[SESSION.id];
	const workbench = () => host.renderer.kernelSdk.domains.get(Workbench)!;
	return { host, run, state, workbench, calls: sessions.calls, tracked: telemetry.tracked };
}

const pane = (id: string, kind = "test.panes/terminal", title = id): Pane => ({
	id,
	kind,
	title,
	metadata: {},
	ordinal: 1,
});

const withPanes = (
	panes: Pane[],
	activePaneId = panes[0]?.id ?? null,
): Record<string, WorkSessionPanes> => ({
	[SESSION.id]: { ...EMPTY_WORK_SESSION_PANES, panes, activePaneId },
});

describe("session panes", () => {
	it("opens a pane from the header, given the session, pane and working folder", async () => {
		const { calls } = await renderPanes();
		await expect.element(page.getByTestId("session-empty")).toBeVisible();

		await page.getByTestId("chat-pane-toolbar-add").click();
		await page.getByTestId("chat-pane-launch-test.panes/terminal").click();

		await vi.waitFor(() =>
			expect(calls.open).toHaveBeenCalledWith({
				sessionId: SESSION.id,
				kind: "test.panes/terminal",
			}),
		);
		await expect
			.element(page.getByTestId(/^terminal-pane_/))
			.toHaveTextContent("wses_1 · Terminal · /projects/app · visible");
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

	it("puts kinds pinned to the header after '+', which leaves them out, and before the carousel", async () => {
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
			.not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		await pinned.click();
		await vi.waitFor(() =>
			expect(calls.open).toHaveBeenCalledWith({
				sessionId: SESSION.id,
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

	it("shows a pane whose plugin isn't here as unavailable", async () => {
		await renderPanes({ panes: withPanes([pane("x", "gone.plugin/thing", "Old pane")]) });

		await expect.element(page.getByText("Old pane isn't available")).toBeVisible();
	});

	it("closes panes from their tab, back to the empty session", async () => {
		const { calls } = await renderPanes({ panes: withPanes([pane("a")]) });

		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-close-tab-a").click();

		await vi.waitFor(() => expect(calls.close).toHaveBeenCalledWith("a"));
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
				sessionId: SESSION.id,
				pane: expect.objectContaining({ id: "e" }),
			}),
		);
		await run("close-pane");
		await vi.waitFor(() => expect(canClose).toHaveBeenCalledTimes(2));

		expect(calls.close).not.toHaveBeenCalled();
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
		await vi.waitFor(() => expect(calls.close).toHaveBeenCalledWith("e"));
		await run("close-pane");
		await vi.waitFor(() => expect(calls.close).toHaveBeenCalledWith("f"));
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
		await vi.waitFor(() => expect(calls.close).toHaveBeenCalledWith("a"));

		await run("toggle-carousel");
		await vi.waitFor(() => expect(calls.setArrangement).toHaveBeenCalledWith("carousel"));
		await expect
			.element(page.getByTestId("chat-pane-arrangement"))
			.toHaveAttribute("aria-pressed", "true");
	});

	it("opens a new tab from the picker, or a new group beside the active one", async () => {
		const { run, state } = await renderPanes({ panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await run("new-pane");
		await page.getByTestId("new-pane-picker-test.panes/terminal").click();
		await vi.waitFor(() => expect(state()?.panes).toHaveLength(2));

		await run("new-group-below");
		await page.getByTestId("new-pane-picker-test.panes/terminal").click();
		await vi.waitFor(() => {
			const layout = parseLayoutJson(state()?.layout);
			expect(layout && flattenPanes(layout)).toHaveLength(3);
			expect(layout?.groups.some((group) => group.stackId !== undefined)).toBe(true);
		});
	});

	it("saves layout changes made on the canvas", async () => {
		const { calls } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-tab-b").click();

		await vi.waitFor(() => expect(calls.setLayout).toHaveBeenCalled());
		expect(parseLayoutJson(calls.setLayout.mock.lastCall?.[0])?.activePaneId).toBe("b");
	});
});

/** A plugin registered after test.panes whose kind asks to be listed first. */
const agentPlugin = {
	manifest: {
		manifestVersion: 1,
		id: "test.agent",
		displayName: "Agent",
		version: "1.0.0",
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{ id: "agent", title: "Agent", launch: { newSession: true }, order: 10 },
				],
			},
		},
	},
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(PaneKind, "agent", { component: () => <div>Agent</div> });
		},
	} satisfies PluginEntry,
};

describe("launcher", () => {
	it("lists pane kinds in their order, then by plugin", async () => {
		await renderPanes({ open: false, extraPlugins: [agentPlugin] });

		await expect.element(page.getByTestId("launcher-pane-test.agent/agent")).toBeVisible();
		const ids = [...document.querySelectorAll('[data-qa-id^="launcher-pane-"]')].map((node) =>
			node.getAttribute("data-qa-id"),
		);
		expect(ids).toEqual(["launcher-pane-test.agent/agent", "launcher-pane-test.panes/terminal"]);
	});

	it("starts a session with a pane kind offered for new sessions", async () => {
		const { host, calls } = await renderPanes({ open: false });

		await page.getByTestId("launcher-pane-test.panes/terminal").click();

		await vi.waitFor(() =>
			expect(calls.open).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "test.panes/terminal" }),
			),
		);
		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domains.get(Workbench)!.getState().activeSessionId).toMatch(
				/^wses_new_/,
			),
		);
		await expect.element(page.getByTestId("launcher-start-session")).not.toBeInTheDocument();
		await expect.element(page.getByTestId(/^terminal-pane_/)).toBeVisible();
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
		const { host, calls } = await renderPanes({
			panes: withPanes([pane("a"), pane("b")]),
			windows,
		});
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-pop-out-tab-a").click();
		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					view: "kilo.workbench/pane",
					title: "a",
					params: { sessionId: SESSION.id, paneId: "a" },
				}),
			),
		);
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.workbench/pane" });
		await expect.element(page.getByTestId("chat-pane-popped-out-a")).toBeVisible();

		await page
			.getByTestId("chat-pane-popped-out-a")
			.getByRole("button", { name: "Bring to front" })
			.click();
		expect(windows.focus).toHaveBeenCalledWith("w9");

		await host.renderer.kernelSdk.domains.get(Workbench)!.methods.closeSession(undefined);
		await vi.waitFor(() => expect(windows.setHidden).toHaveBeenCalledWith("w9", true));
		await host.renderer.kernelSdk.domains
			.get(Workbench)!
			.methods.openSession({ sessionId: SESSION.id });
		await vi.waitFor(() => expect(windows.setHidden).toHaveBeenLastCalledWith("w9", false));

		await page.getByTestId("chat-pane-popped-out-a").getByRole("button", { name: "Dock" }).click();
		expect(windows.close).toHaveBeenCalledWith("w9");
		host.main.windowEvents.closed("w9");
		await vi.waitFor(() => expect(calls.activate).toHaveBeenCalledWith("a"));
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();
	});

	it("closes a pop-out whose pane was closed", async () => {
		const windows = hostWindows();
		const { host } = await renderPanes({ panes: withPanes([pane("a"), pane("b")]), windows });
		await host.renderer.kernelSdk.domains.get(KernelWindows)!.methods.open({
			view: "kilo.workbench/pane",
			key: `${SESSION.id}/b`,
			params: { sessionId: SESSION.id, paneId: "b" },
		});
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.workbench/pane" });

		await host.renderer.kernelSdk.domains
			.get(Panes)!
			.methods.close({ sessionId: SESSION.id, paneId: "b" });

		await vi.waitFor(() => expect(windows.close).toHaveBeenCalledWith("w9"));
	});

	it("shows the pane in its window, with a Dock button that closes the window", async () => {
		const { host } = await renderPanes({ panes: withPanes([pane("a")]), windows: hostWindows() });
		const view = host.renderer.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.workbench/pane")!;
		const windowView = (params: Record<string, string>) => (
			<KernelProvider kernel={host.renderer}>
				<RenderContribution contribution={view} props={{ params }} />
			</KernelProvider>
		);
		const shown = render(windowView({ sessionId: SESSION.id, paneId: "a" }));

		const header = page.getByTestId("pane-window-header");
		await expect.element(header.getByText("Fix login")).toBeVisible();
		await expect.element(page.getByTestId("pane-window").getByTestId("terminal-a")).toBeVisible();
		shown.unmount();

		render(windowView({ sessionId: SESSION.id, paneId: "gone" }));
		await expect.element(page.getByTestId("pane-window-gone")).toBeVisible();
	});
});

describe("layout telemetry", () => {
	const events = (tracked: ReturnType<typeof fakeTelemetry>["tracked"], name: string) =>
		tracked.mock.calls.filter(([event]) => event === name).map(([, data]) => data);

	it("reports panes a person opens and closes, by kind", async () => {
		const { run, tracked } = await renderPanes({ panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("terminal-a")).toBeVisible();

		await page.getByTestId("chat-pane-toolbar-add").click();
		await page.getByTestId("chat-pane-launch-test.panes/terminal").click();
		await vi.waitFor(() =>
			expect(events(tracked, "Pane Opened")).toEqual([{ paneType: "test.panes/terminal" }]),
		);

		await page.getByTestId("chat-pane-tab-a").hover();
		await page.getByTestId("chat-pane-close-tab-a").click();
		await vi.waitFor(() =>
			expect(events(tracked, "Pane Closed")).toEqual([{ paneType: "test.panes/terminal" }]),
		);
		await run("close-pane");
		await vi.waitFor(() => expect(events(tracked, "Pane Closed")).toHaveLength(2));
	});

	it("doesn't report a pane its kind kept open", async () => {
		canClose.mockReset();
		canClose.mockResolvedValue(false);
		const { run, calls, tracked } = await renderPanes({
			panes: withPanes([pane("e", "test.panes/guarded", "notes.md")]),
		});
		await expect.element(page.getByTestId("editor-e")).toBeVisible();

		await run("close-pane");
		await vi.waitFor(() => expect(canClose).toHaveBeenCalled());
		expect(calls.close).not.toHaveBeenCalled();
		expect(events(tracked, "Pane Closed")).toEqual([]);
		canClose.mockReset();
		canClose.mockResolvedValue(true);
	});

	it("reports arrangement changes from the header and the command", async () => {
		const { run, tracked } = await renderPanes({ panes: withPanes([pane("a")]) });

		await page.getByTestId("chat-pane-arrangement").click();
		await vi.waitFor(() =>
			expect(events(tracked, "Layout Arrangement Changed")).toEqual([{ arrangement: "carousel" }]),
		);
		await run("toggle-carousel");
		await vi.waitFor(() =>
			expect(events(tracked, "Layout Arrangement Changed")).toEqual([
				{ arrangement: "carousel" },
				{ arrangement: "tiles" },
			]),
		);
	});
});

describe("Workbench.openPane (for other plugins' commands)", () => {
	it("opens the kind once, then shows the pane it already has", async () => {
		const { workbench, state, calls, tracked } = await renderPanes({
			panes: withPanes([pane("a"), pane("g", "test.panes/guarded", "notes.md")], "g"),
			extraPlugins: [pinnedPlugin],
		});
		await expect.element(page.getByTestId("editor-g")).toBeVisible();

		await workbench().methods.openPane({ kind: "test.panes/terminal" });
		await vi.waitFor(() => expect(state()?.activePaneId).toBe("a"));
		expect(calls.open).not.toHaveBeenCalled();

		await workbench().methods.openPane({ kind: "test.pinned/helper" });
		await vi.waitFor(() =>
			expect(calls.open).toHaveBeenCalledWith({
				sessionId: SESSION.id,
				kind: "test.pinned/helper",
			}),
		);
		expect(tracked).toHaveBeenCalledWith("Pane Opened", { paneType: "test.pinned/helper" });
		expect(tracked.mock.calls.filter(([event]) => event === "Pane Opened")).toHaveLength(1);
	});

	it("does nothing with no session open", async () => {
		const { workbench, calls } = await renderPanes({ panes: withPanes([pane("a")]) });
		await workbench().methods.closeSession(undefined);

		await workbench().methods.openPane({ kind: "test.pinned/helper" });

		expect(calls.open).not.toHaveBeenCalled();
	});

	it("brings a popped-out pane's window forward", async () => {
		const windows = {
			open: vi.fn(async () => "w9"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
		};
		const { host, workbench } = await renderPanes({ panes: withPanes([pane("a")]), windows });
		await host.renderer.kernelSdk.domains.get(KernelWindows)!.methods.open({
			view: "kilo.workbench/pane",
			key: `${SESSION.id}/a`,
			params: { sessionId: SESSION.id, paneId: "a" },
		});
		host.main.windowEvents.opened("w9", { role: "secondary", view: "kilo.workbench/pane" });
		await expect.element(page.getByTestId("chat-pane-popped-out-a")).toBeVisible();

		await workbench().methods.openPane({ kind: "test.panes/terminal" });

		await vi.waitFor(() => expect(windows.focus).toHaveBeenCalledWith("w9"));
	});
});
