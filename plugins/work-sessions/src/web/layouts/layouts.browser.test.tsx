import { TerminalIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";

import {
	CHAT_LAYOUTS_FLAG,
	EMPTY_WORK_SESSION_PANES,
	type LayoutPreset,
	type LayoutTemplate,
	type Pane,
	type PaneProps,
	type WorkSessionPanes,
} from "../../contracts";
import {
	grantDataCollection,
	pane as paneRecord,
	paneKindPlugin,
	renderWorkSessions,
	telemetrySink,
	workSession,
	workspace,
} from "../../testing";

const TERMINAL = "test.panes/terminal";
const NOTES = "test.panes/notes";
/** The id the stand-in gives the first work session it creates (after the seeded one). */
const NEW_ID = "wses_2";

const SESSION = workSession("wses_1", { title: "Fix login", workspaceId: "w-app" });
const APP = workspace("w-app", "App");

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

const pane = (id: string, kind = TERMINAL, title = id): Pane => paneRecord(id, kind, { title });

/** A terminal kind (startable anywhere) and a notes kind that only opens objects. */
const panesPlugin = paneKindPlugin("test.panes", [
	{
		id: "terminal",
		metadata: { title: "Terminal", launch: { newSession: true, inSession: true } },
		component: ({ pane: shown }: PaneProps) => (
			<div data-qa-id={`terminal-${shown.id}`}>{shown.title}</div>
		),
		icon: TerminalIcon,
	},
	{
		id: "notes",
		metadata: { title: "Notes", launch: { newSession: false, inSession: false } },
		component: () => <div>Notes</div>,
	},
]);

async function renderLayouts(
	options: {
		panes?: WorkSessionPanes;
		layouts?: { presets: LayoutPreset[]; defaultPresetId: string | null } | null;
		flag?: boolean;
		open?: boolean;
	} = {},
) {
	const sink = telemetrySink();
	const rendered = await renderWorkSessions({
		workSessions: [SESSION],
		workspaces: [APP],
		activeWorkspaceId: APP.id,
		panes: { [SESSION.id]: options.panes ?? EMPTY_WORK_SESSION_PANES },
		...(options.layouts === null
			? { presets: null }
			: {
					presets: options.layouts?.presets ?? [],
					defaultPresetId: options.layouts?.defaultPresetId ?? null,
				}),
		...(options.open === false ? {} : { open: SESSION.id }),
		flags: { [CHAT_LAYOUTS_FLAG]: options.flag !== false },
		guests: [panesPlugin, sink.plugin],
		beforeRender: grantDataCollection,
	});
	const panesOf = (workSessionId: string) => rendered.panesState(workSessionId);
	const layoutsState = () => rendered.main.presets().state;
	return { ...rendered, panesOf, layoutsState, sink };
}

const withPanes = (panes: Pane[]): WorkSessionPanes => ({
	...EMPTY_WORK_SESSION_PANES,
	panes,
	activePaneId: panes[0]?.id ?? null,
});

const menu = () => page.getByTestId("chat-layouts-menu");

describe("layout presets menu", () => {
	it("shows only while the chat-layouts flag is on", async () => {
		await renderLayouts({ flag: false, panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("session-header-actions")).toBeVisible();
		expect(menu().elements()).toHaveLength(0);
	});

	it("hides without the layout presets domain object", async () => {
		await renderLayouts({ layouts: null, panes: withPanes([pane("a")]) });
		await expect.element(page.getByTestId("session-header-actions")).toBeVisible();
		expect(menu().elements()).toHaveLength(0);
	});

	it("saves the current panes, disclosing omissions, as the default", async () => {
		const { calls, layoutsState, sink } = await renderLayouts({
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
		expect(calls.savePreset).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Research", makeDefault: true }),
		);
		expect(layoutsState().presets[0]?.template.slots).toEqual([{ id: "slot-1", kind: TERMINAL }]);
		await vi.waitFor(() =>
			expect(sink.events("layout-preset-saved")).toContainEqual({
				isUpdate: false,
				makeDefault: true,
				paneCount: 1,
			}),
		);
		await menu().click();
		await expect
			.element(
				page.getByTestId(`chat-layout-apply-${layoutsState().presets[0]!.id}`).getByText("Default"),
			)
			.toBeVisible();
	});

	it("applies a preset, reusing the session's pane and opening the rest in the background", async () => {
		const { calls, panesOf, sink } = await renderLayouts({
			panes: withPanes([pane("a", TERMINAL, "Server")]),
			layouts: { presets: [coding], defaultPresetId: null },
		});
		await menu().click();
		await page.getByTestId("chat-layout-apply-coding").click();

		await vi.waitFor(() => expect(panesOf(SESSION.id)?.arrangement).toBe("carousel"));
		expect(calls.openPane).toHaveBeenCalledTimes(1);
		expect(calls.openPane).toHaveBeenCalledWith(
			expect.objectContaining({ kind: TERMINAL, activate: false }),
		);
		const layout = parseLayoutJson(panesOf(SESSION.id)?.layout)!;
		expect(layout.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
			["a"],
			[expect.stringMatching(/^pane_/)],
		]);
		expect(layout.groups.map((group) => group.preferredWidth)).toEqual([500, 420]);
		expect(layout.activePaneId).toBe(flattenPanes(layout)[1]?.id);
		await vi.waitFor(() => expect(sink.events("layout-preset-applied")).toEqual([{}]));
	});

	it("manages the default, renames and deletes with confirmation", async () => {
		const { layoutsState, sink } = await renderLayouts({
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
			expect(sink.events("layout-preset-default-changed")).toEqual([
				{ cleared: false },
				{ cleared: true },
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
		await vi.waitFor(() => expect(sink.events("layout-preset-removed")).toEqual([{}]));
		await page.getByTestId("chat-layout-manage-close").click();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});

	it("updates a preset from the current panes, keeping the default", async () => {
		const { calls, layoutsState, sink } = await renderLayouts({
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
		expect(calls.savePreset.mock.lastCall?.[0]).toMatchObject({ makeDefault: undefined });
		expect(layoutsState().defaultPresetId).toBe("coding");
		await vi.waitFor(() =>
			expect(sink.events("layout-preset-saved")).toEqual([
				{ isUpdate: true, makeDefault: false, paneCount: 1 },
			]),
		);
	});

	it("keeps a failed save editable, then saves on retry", async () => {
		const { calls, main, sink } = await renderLayouts({ panes: withPanes([pane("a")]) });
		main.failNextWith("You can save up to 100 layouts.");
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
		expect(calls.savePreset).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(sink.events("layout-preset-saved")).toHaveLength(1));
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
	it("is applied to a work session the New Session page starts empty, untracked as it isn't a person's choice", async () => {
		const { run, window, calls, panesOf, sink } = await renderLayouts({
			open: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
		await run("new-empty-work-session");

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe(NEW_ID));
		await vi.waitFor(() => expect(panesOf(NEW_ID)?.arrangement).toBe("carousel"));
		expect(calls.openPane).toHaveBeenCalledTimes(2);
		expect(flattenPanes(parseLayoutJson(panesOf(NEW_ID)?.layout)!)).toHaveLength(2);
		expect(sink.events("layout-preset-applied")).toEqual([]);
	});

	it("is not applied to a session started with a pane", async () => {
		const { calls, panesOf } = await renderLayouts({
			open: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await page.getByTestId(`launcher-pane-${TERMINAL}`).click();

		await expect.element(page.getByTestId(/^terminal-pane_/)).toBeVisible();
		expect(calls.openPane).toHaveBeenCalledTimes(1);
		expect(panesOf(NEW_ID)?.arrangement).toBe("tiles");
	});

	it("is not applied while the flag is off", async () => {
		const { run, window, calls } = await renderLayouts({
			open: false,
			flag: false,
			layouts: { presets: [coding], defaultPresetId: "coding" },
		});
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();
		await run("new-empty-work-session");

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe(NEW_ID));
		await expect.element(page.getByTestId("session-empty")).toBeVisible();
		expect(calls.openPane).not.toHaveBeenCalled();
	});
});
