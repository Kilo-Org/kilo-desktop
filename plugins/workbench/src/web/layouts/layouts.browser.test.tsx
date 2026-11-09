import { TerminalIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	KernelError,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type OpenPaneInput,
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
import {
	Layouts,
	Workbench,
	WORKBENCH_DEFINITIONS,
	type LayoutPreset,
	type LayoutTemplate,
	type LayoutsState,
} from "../../contracts";
import { workbenchWebEntry } from "../index";

const TERMINAL = "test.panes/terminal";
const NOTES = "test.panes/notes";

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

const twoTerminals: LayoutTemplate = {
	version: 2,
	arrangement: "carousel",
	activePaneId: "two",
	slots: [
		{ id: "one", kind: TERMINAL },
		{ id: "two", kind: TERMINAL },
	],
	groups: [
		{ id: "left", tabs: ["one"], activePaneId: "one", width: 500, pinned: false },
		{ id: "right", tabs: ["two"], activePaneId: "two", width: 420, pinned: false },
	],
};
const coding: LayoutPreset = { id: "coding", name: "Coding", template: twoTerminals };

const pane = (id: string, kind = TERMINAL, title = id): Pane => ({
	id,
	kind,
	title,
	metadata: {},
	ordinal: 1,
});

/** kilo.sessions' main, with sessions and panes kept in memory. */
function fakeSessionsMain(initialPanes: WorkSessionPanes) {
	const calls = {
		open: vi.fn<(input: OpenPaneInput) => void>(),
		setLayout: vi.fn<(layout: string) => void>(),
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
				initialState: { bySession: { [SESSION.id]: initialPanes } },
				methods: {
					open: (input) => {
						calls.open(input);
						const current = of(input.sessionId);
						const opened = pane(`pane_${++next}`, input.kind, input.title ?? "Terminal");
						write(input.sessionId, {
							...current,
							panes: [...current.panes, opened],
							activePaneId: input.activate === false ? current.activePaneId : opened.id,
						});
						return opened;
					},
					openObject: () => null,
					activate: ({ sessionId, paneId }) =>
						write(sessionId, { ...of(sessionId), activePaneId: paneId }),
					update: () => {
						throw new Error("unused");
					},
					close: () => ({ closed: false }),
					setLayout: ({ sessionId, layout, activePaneId }) => {
						calls.setLayout(layout);
						write(sessionId, {
							...of(sessionId),
							layout,
							...(activePaneId !== undefined ? { activePaneId } : {}),
						});
					},
					setArrangement: ({ sessionId, arrangement }) =>
						write(sessionId, { ...of(sessionId), arrangement }),
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

/** kilo.workbench's Layouts, kept in memory; `failSave` makes the next save fail. */
function fakeLayoutsMain(initial: LayoutsState) {
	const calls = { save: vi.fn() };
	const control = { failSave: null as string | null };
	const entry: PluginEntry = {
		activate(sdk) {
			const layouts: DomainProvider<typeof Layouts> = sdk.domains.provide(Layouts, {
				initialState: initial,
				methods: {
					save: (input) => {
						calls.save(input);
						if (control.failSave) {
							const message = control.failSave;
							control.failSave = null;
							throw new KernelError("VALIDATION", message);
						}
						const preset = { id: input.id ?? "saved", name: input.name, template: input.template };
						const { presets, defaultPresetId } = layouts.state;
						layouts.setState({
							presets: input.id
								? presets.map((entry) => (entry.id === input.id ? preset : entry))
								: [...presets, preset],
							defaultPresetId: input.makeDefault ? preset.id : defaultPresetId,
						});
						return preset;
					},
					rename: ({ id, name }) => {
						const state = layouts.state;
						layouts.setState({
							...state,
							presets: state.presets.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
						});
					},
					remove: ({ id }) => {
						const state = layouts.state;
						layouts.setState({
							presets: state.presets.filter((entry) => entry.id !== id),
							defaultPresetId: state.defaultPresetId === id ? null : state.defaultPresetId,
						});
					},
					setDefault: ({ id }) => layouts.setState({ ...layouts.state, defaultPresetId: id }),
				},
			});
		},
	};
	return { entry, calls, control };
}

/** A stand-in for kilo.flags that turns layout presets on. */
const chatLayoutsFlag: GuestPlugin = {
	manifest: testManifest("kilo.flags", { contextKeys: [{ id: "flag:*", scope: "global" }] }),
	main: {
		activate: (sdk) => {
			sdk.context.set("flag:chat-layouts", true);
		},
	},
};

/** A terminal kind (startable anywhere) and a notes kind that only opens objects. */
const panesPlugin: GuestPlugin = {
	manifest: testManifest("test.panes", {
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{ id: "terminal", title: "Terminal", launch: { newSession: true, inSession: true } },
					{ id: "notes", title: "Notes", launch: { newSession: false, inSession: false } },
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			const Terminal = ({ pane: shown }: PaneProps) => (
				<div data-qa-id={`terminal-${shown.id}`}>{shown.title}</div>
			);
			sdk.extensions.implement(PaneKind, "terminal", { component: Terminal, icon: TerminalIcon });
			sdk.extensions.implement(PaneKind, "notes", { component: () => <div>Notes</div> });
		},
	},
};

async function renderLayouts(
	options: {
		panes?: WorkSessionPanes;
		layouts?: LayoutsState | null;
		flag?: boolean;
		open?: boolean;
	} = {},
) {
	const sessions = fakeSessionsMain(options.panes ?? EMPTY_WORK_SESSION_PANES);
	const layouts = fakeLayoutsMain(options.layouts ?? { presets: [], defaultPresetId: null });
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
			{
				manifest,
				definitions: WORKBENCH_DEFINITIONS,
				web: workbenchWebEntry,
				...(options.layouts === null ? {} : { main: layouts.entry }),
			},
			panesPlugin,
			...(options.flag === false ? [] : [chatLayoutsFlag]),
		],
		options.open === false
			? {}
			: {
					localAppearance: {
						"kilo.workbench.navigator:main": JSON.stringify({
							focus: null,
							activeSessionId: SESSION.id,
						}),
					},
				},
	);
	const panesOf = (sessionId: string) =>
		host.renderer.kernelSdk.domains.get(Panes)!.getState().bySession[sessionId];
	const layoutsState = () => host.renderer.kernelSdk.domains.get(Layouts)!.getState();
	return {
		host,
		panesOf,
		layoutsState,
		sessions: sessions.calls,
		layouts,
		tracked: telemetry.tracked,
	};
}

const withPanes = (panes: Pane[]): WorkSessionPanes => ({
	...EMPTY_WORK_SESSION_PANES,
	panes,
	activePaneId: panes[0]?.id ?? null,
});

const menu = () => page.getByTestId("chat-layouts-menu");

describe("layout presets menu", () => {
	it("shows only while the chat-layouts flag is on and kilo.workbench's main is there", async () => {
		await renderLayouts({ flag: false, panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("session-header-actions")).toBeVisible();
		expect(menu().elements()).toHaveLength(0);
	});

	it("hides without the Layouts domain (browser mode)", async () => {
		await renderLayouts({ layouts: null, panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("session-header-actions")).toBeVisible();
		expect(menu().elements()).toHaveLength(0);
	});

	it("saves the current panes, disclosing omissions, as the default", async () => {
		const { layouts, layoutsState, tracked } = await renderLayouts({
			panes: withPanes([pane("a", TERMINAL, "Server"), pane("n", NOTES, "todo.md")]),
		});
		await menu().click();
		await expect.element(page.getByText("No layouts yet")).toBeVisible();
		await page.getByTestId("chat-layout-save-current").click();
		await expect.element(page.getByText(/todo\.md cannot be recreated/)).toBeVisible();
		await expect.element(page.getByTestId("chat-layout-save")).toBeDisabled();
		await page.getByTestId("chat-layout-name").fill("Research");
		await page.getByTestId("chat-layout-default").click();
		await page.getByTestId("chat-layout-save").click();

		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		expect(layouts.calls.save).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Research", makeDefault: true }),
		);
		expect(layoutsState().presets[0]?.template.slots).toEqual([{ id: "slot-1", kind: TERMINAL }]);
		await vi.waitFor(() =>
			expect(tracked).toHaveBeenCalledWith("Layout Preset Saved", {
				isUpdate: false,
				makeDefault: true,
				paneCount: 1,
			}),
		);
		await menu().click();
		await expect
			.element(page.getByTestId("chat-layout-apply-saved").getByText("Default"))
			.toBeVisible();
	});

	it("applies a preset, reusing the session's pane and opening the rest in the background", async () => {
		const { sessions, panesOf, tracked } = await renderLayouts({
			panes: withPanes([pane("a", TERMINAL, "Server")]),
			layouts: { presets: [coding], defaultPresetId: null },
		});
		await menu().click();
		await page.getByTestId("chat-layout-apply-coding").click();

		await vi.waitFor(() => expect(panesOf(SESSION.id)?.arrangement).toBe("carousel"));
		expect(sessions.open).toHaveBeenCalledTimes(1);
		expect(sessions.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: TERMINAL, activate: false }),
		);
		const layout = parseLayoutJson(panesOf(SESSION.id)?.layout)!;
		expect(layout.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
			["a"],
			[expect.stringMatching(/^pane_/)],
		]);
		expect(layout.groups.map((group) => group.preferredWidth)).toEqual([500, 420]);
		expect(layout.activePaneId).toBe(flattenPanes(layout)[1]?.id);
		await vi.waitFor(() => expect(tracked).toHaveBeenCalledWith("Layout Preset Applied", {}));
	});

	it("manages the default, renames and deletes with confirmation", async () => {
		const { layoutsState, tracked } = await renderLayouts({
			panes: withPanes([pane("a")]),
			layouts: {
				presets: [coding, { ...coding, id: "review", name: "Review" }],
				defaultPresetId: null,
			},
		});
		await menu().click();
		await page.getByTestId("chat-layout-manage").click();
		const codingStar = page.getByTestId("chat-layout-set-default-coding");
		await codingStar.click();
		await expect.element(codingStar).toHaveAttribute("aria-pressed", "true");
		await page.getByRole("button", { name: "Clear default layout" }).click();
		await expect.element(codingStar).toHaveAttribute("aria-pressed", "false");
		expect(layoutsState().defaultPresetId).toBeNull();
		await vi.waitFor(() =>
			expect(
				tracked.mock.calls.filter(([event]) => event === "Layout Preset Default Changed"),
			).toEqual([
				["Layout Preset Default Changed", { cleared: false }],
				["Layout Preset Default Changed", { cleared: true }],
			]),
		);

		await page.getByRole("button", { name: "Rename Coding" }).click();
		await page.getByTestId("chat-layout-name").fill("Focus");
		await page.getByRole("button", { name: "Save name" }).click();
		await expect.element(page.getByRole("button", { name: "Rename Focus" })).toBeVisible();
		await page.getByRole("button", { name: "Rename Focus" }).click();
		await page.getByTestId("chat-layout-name").fill("Discarded");
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("button", { name: "Rename Focus" })).toBeVisible();

		await page.getByRole("button", { name: "Delete Review", exact: true }).click();
		await expect.element(page.getByRole("alertdialog")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await page.getByRole("button", { name: "Delete Review", exact: true }).click();
		await page.getByTestId("chat-layout-delete-confirm").click();
		await expect.element(page.getByRole("button", { name: "Rename Focus" })).toBeVisible();
		await vi.waitFor(() =>
			expect(layoutsState().presets.map((preset) => preset.id)).toEqual(["coding"]),
		);
		expect(tracked).toHaveBeenCalledWith("Layout Preset Removed", {});
		await page.getByTestId("chat-layout-manage-close").click();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});

	it("updates a preset from the current panes, keeping the default", async () => {
		const { layouts, layoutsState, tracked } = await renderLayouts({
			panes: withPanes([pane("a")]),
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await menu().click();
		await page.getByTestId("chat-layout-manage").click();
		await page.getByRole("button", { name: "Update Coding from current layout" }).click();
		await expect.element(page.getByRole("dialog", { name: "Update Coding" })).toBeVisible();
		await page.getByRole("button", { name: "Update layout", exact: true }).click();

		await vi.waitFor(() =>
			expect(layoutsState().presets[0]?.template.slots).toEqual([{ id: "slot-1", kind: TERMINAL }]),
		);
		expect(layouts.calls.save.mock.lastCall?.[0]).not.toHaveProperty("makeDefault");
		expect(layoutsState().defaultPresetId).toBe("coding");
		expect(tracked).toHaveBeenCalledWith("Layout Preset Saved", {
			isUpdate: true,
			makeDefault: false,
			paneCount: 1,
		});
	});

	it("keeps a failed save editable, then saves on retry", async () => {
		const { layouts, tracked } = await renderLayouts({ panes: withPanes([pane("a")]) });
		layouts.control.failSave = "You can save up to 100 layouts.";
		await menu().click();
		await page.getByTestId("chat-layout-save-current").click();
		await page.getByTestId("chat-layout-name").fill("Coding");
		await page.getByTestId("chat-layout-save").click();

		await expect
			.element(page.getByRole("dialog").getByText("You can save up to 100 layouts."))
			.toBeVisible();
		await expect.element(page.getByTestId("chat-layout-name")).toHaveValue("Coding");
		await page.getByTestId("chat-layout-save").click();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		expect(layouts.calls.save).toHaveBeenCalledTimes(2);
		await vi.waitFor(() =>
			expect(tracked.mock.calls.filter(([event]) => event === "Layout Preset Saved")).toHaveLength(
				1,
			),
		);
	});

	it("won't save a session with nothing to recreate, and says so", async () => {
		await renderLayouts({ panes: withPanes([pane("n", NOTES, "todo.md")]) });
		await menu().click();
		await page.getByTestId("chat-layout-save-current").click();

		await expect
			.element(page.getByText("No reusable panes to save. Open a pane with + first."))
			.toBeVisible();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});
});

describe("default layout", () => {
	it("is applied to a session the launcher starts empty, untracked as it isn't a person's choice", async () => {
		const { host, sessions, panesOf, tracked } = await renderLayouts({
			open: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domains.get(Workbench)!.getState().activeSessionId).toBe(
				"wses_new_1",
			),
		);
		await vi.waitFor(() => expect(panesOf("wses_new_1")?.arrangement).toBe("carousel"));
		expect(sessions.open).toHaveBeenCalledTimes(2);
		expect(flattenPanes(parseLayoutJson(panesOf("wses_new_1")?.layout)!)).toHaveLength(2);
		expect(tracked).not.toHaveBeenCalledWith("Layout Preset Applied", expect.anything());
	});

	it("is not applied to a session started with a pane", async () => {
		const { sessions, panesOf } = await renderLayouts({
			open: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await page.getByTestId(`launcher-pane-${TERMINAL}`).click();

		await expect.element(page.getByTestId(/^terminal-pane_/)).toBeVisible();
		expect(sessions.open).toHaveBeenCalledTimes(1);
		expect(panesOf("wses_new_1")?.arrangement).toBe("tiles");
	});

	it("is not applied while the flag is off", async () => {
		const { host, sessions } = await renderLayouts({
			open: false,
			flag: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domains.get(Workbench)!.getState().activeSessionId).toBe(
				"wses_new_1",
			),
		);
		await expect.element(page.getByTestId("session-empty")).toBeVisible();
		expect(sessions.open).not.toHaveBeenCalled();
	});
});
