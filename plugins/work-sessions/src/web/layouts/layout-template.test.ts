import { describe, expect, it, vi } from "vitest";

import {
	createLayout,
	descriptor,
	flattenPanes,
	parseLayoutJson,
	serializeLayout,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import {
	EMPTY_WORK_SESSION_PANES,
	type OpenPaneInput,
	type Pane,
	type WorkSessionPanes,
} from "../../contracts";

import { layoutTemplateSchema, type LayoutTemplate } from "../../contracts";
import type { PanesHandle } from "../shared/pane-actions";
import {
	applyLayoutTemplate,
	buildTemplateLayout,
	captureLayoutTemplate,
	planLayoutTemplate,
	type TemplateKinds,
} from "./layout-template";

const AGENT = "kilo.chat/agent";
const CHANGES = "kilo.git/changes";
const TERMINAL = "kilo.terminal/terminal";
const FILE = "kilo.files/file";

const launch = (inSession: boolean, newSession = false) => ({
	metadata: { launch: { inSession, newSession } },
});

const kinds: TemplateKinds = {
	byKey: new Map([
		[AGENT, launch(false, true)],
		[CHANGES, launch(true)],
		[TERMINAL, launch(true)],
		[FILE, launch(false)],
	]),
	layoutKindOf: (kind) => (kind === AGENT ? "agent" : kind === FILE ? "document" : "tool"),
};

const pane = (
	id: string,
	kind: string,
	title = id,
	metadata: Record<string, string> = {},
): Pane => ({
	id,
	kind,
	title,
	metadata,
	ordinal: 1,
});

const session = (panes: Pane[], layout?: PaneLayout, extra: Partial<WorkSessionPanes> = {}) => ({
	...EMPTY_WORK_SESSION_PANES,
	panes,
	activePaneId: layout?.activePaneId ?? panes[0]?.id ?? null,
	layout: layout ? serializeLayout(layout) : null,
	...extra,
});

const coding: LayoutTemplate = {
	version: 2,
	arrangement: "tiles",
	activePaneId: "chat",
	slots: [
		{ id: "chat", kind: AGENT },
		{ id: "changes", kind: CHANGES },
		{ id: "terminal", kind: TERMINAL },
	],
	groups: [
		{ id: "left", tabs: ["chat"], activePaneId: "chat", width: 450, pinned: true },
		{
			id: "top",
			tabs: ["changes"],
			activePaneId: "changes",
			width: 550,
			pinned: false,
			stackId: "right",
			stackWeight: 0.6,
		},
		{
			id: "bottom",
			tabs: ["terminal"],
			activePaneId: "terminal",
			width: 550,
			pinned: false,
			stackId: "right",
			stackWeight: 0.4,
		},
	],
};

/** The panes domain object, held in memory. */
function fakePanes(initial: WorkSessionPanes, options: { singleton?: string } = {}) {
	let state = initial;
	let next = 0;
	const open = vi.fn(async (input: OpenPaneInput) => {
		const existing = state.panes.find((entry) => entry.kind === options.singleton);
		if (existing && input.kind === options.singleton) return existing;
		const opened = pane(`new-${++next}`, input.kind, `Opened ${input.kind}`);
		state = { ...state, panes: [...state.panes, opened] };
		return opened;
	});
	const setLayout = vi.fn(
		async (input: { layout: string; activePaneId?: string | null | undefined }) => {
			state = { ...state, layout: input.layout, activePaneId: input.activePaneId ?? null };
		},
	);
	const setArrangement = vi.fn(async ({ arrangement }: { arrangement: "tiles" | "carousel" }) => {
		state = { ...state, arrangement };
	});
	const handle = {
		getState: () => ({ byWorkSession: { s: state } }),
		methods: { open, setLayout, setArrangement },
	} as unknown as PanesHandle;
	return { handle, open, setLayout, setArrangement, state: () => state };
}

describe("capturing a layout template", () => {
	it("captures geometry and kinds, not pane identities, titles or metadata", () => {
		const layout: PaneLayout = {
			...createLayout([
				descriptor({ id: "chat-src", kind: "agent", title: "Private chat" }),
				descriptor({ id: "diff", kind: "tool", title: "Changes" }),
				descriptor({ id: "pty", kind: "tool", title: "Secret command" }),
			]),
			activePaneId: "pty",
			sizes: { "group:chat-src": 450, "group:diff": 550, "group:pty": 550 },
		};
		layout.groups[0] = { ...layout.groups[0]!, pinned: true };
		layout.groups[1] = { ...layout.groups[1]!, stackId: "private-stack", stackWeight: 0.6 };
		layout.groups[2] = { ...layout.groups[2]!, stackId: "private-stack", stackWeight: 0.4 };
		const state = session(
			[
				pane("chat-src", AGENT, "Private chat"),
				pane("diff", CHANGES, "Changes"),
				pane("pty", TERMINAL, "Secret command", { terminalSessionId: "source" }),
			],
			layout,
			{ arrangement: "carousel" },
		);

		const { template, omittedTitles } = captureLayoutTemplate(state, kinds);

		expect(omittedTitles).toEqual([]);
		expect(template.arrangement).toBe("carousel");
		expect(template.activePaneId).toBe("slot-3");
		expect(template.slots.map((slot) => slot.kind)).toEqual([AGENT, CHANGES, TERMINAL]);
		expect(template.groups.map((group) => group.width)).toEqual([450, 550, 550]);
		expect(template.groups.map((group) => group.pinned)).toEqual([true, false, false]);
		expect(template.groups.map((group) => group.stackWeight)).toEqual([undefined, 0.6, 0.4]);
		expect(template.groups[1]?.stackId).toBe(template.groups[2]?.stackId);
		expect(JSON.stringify(template)).not.toMatch(
			/src|private|Private|Secret|pty|terminalSessionId/,
		);
		expect(layoutTemplateSchema.safeParse(template).success).toBe(true);
	});

	it("omits panes it can't recreate and normalizes the stacks and tabs that survive", () => {
		const layout = createLayout([
			descriptor({ id: "doc", kind: "document", title: "secret.ts" }),
			descriptor({ id: "term", kind: "tool", title: "Terminal" }),
			descriptor({ id: "gone", kind: "tool", title: "Old pane" }),
		]);
		layout.groups[0] = { ...layout.groups[0]!, stackId: "s", stackWeight: 0.5 };
		layout.groups[1] = { ...layout.groups[1]!, stackId: "s", stackWeight: 0.5 };
		const state = session(
			[
				pane("doc", FILE, "secret.ts", { path: "/private/project/secret.ts" }),
				pane("term", TERMINAL, "Terminal"),
				pane("gone", "missing.plugin/thing", "Old pane"),
			],
			layout,
		);

		const { template, omittedTitles } = captureLayoutTemplate(state, kinds);

		expect(omittedTitles).toEqual(["secret.ts", "Old pane"]);
		expect(template.slots).toEqual([{ id: "slot-1", kind: TERMINAL }]);
		expect(template.groups[0]?.stackId).toBeUndefined();
		expect(template.groups[0]?.stackWeight).toBeUndefined();
		expect(template.groups[0]?.activePaneId).toBe("slot-1");
		expect(template.activePaneId).toBe("slot-1");
		expect(JSON.stringify(template)).not.toContain("/private/project");
	});

	it("captures panes the canvas hasn't placed yet and leaves out an empty session's active pane", () => {
		const { template } = captureLayoutTemplate(session([pane("t", TERMINAL)]), kinds);
		expect(template.slots).toEqual([{ id: "slot-1", kind: TERMINAL }]);

		const empty = captureLayoutTemplate(EMPTY_WORK_SESSION_PANES, kinds).template;
		expect(empty.slots).toEqual([]);
		expect(empty).not.toHaveProperty("activePaneId");
	});
});

describe("planning a template for a session", () => {
	it("reuses panes of a slot's kind one-to-one, in tab order, and opens the rest", () => {
		const template: LayoutTemplate = {
			version: 2,
			arrangement: "tiles",
			slots: [
				{ id: "one", kind: TERMINAL },
				{ id: "two", kind: TERMINAL },
				{ id: "diff", kind: CHANGES },
			],
			groups: [
				{
					id: "tabs",
					tabs: ["one", "two", "diff"],
					activePaneId: "two",
					width: 600,
					pinned: false,
				},
			],
		};
		const layout = createLayout([
			descriptor({ id: "pty-b", kind: "tool", title: "B" }),
			descriptor({ id: "pty-a", kind: "tool", title: "A" }),
		]);
		const state = session(
			[pane("pty-a", TERMINAL), pane("pty-b", TERMINAL), pane("doc", FILE)],
			layout,
		);

		const plan = planLayoutTemplate(template, state, kinds);

		expect([...plan.reused].map(([slot, reused]) => [slot, reused.id])).toEqual([
			["one", "pty-b"],
			["two", "pty-a"],
		]);
		expect(plan.opens).toEqual([{ slotId: "diff", kind: CHANGES }]);
		expect(plan.extras.map((extra) => extra.id)).toEqual(["doc"]);
		expect(plan.skipped).toEqual([]);
	});

	it("skips slots whose kind no plugin here contributes, keeping such panes as extras", () => {
		const template: LayoutTemplate = {
			...coding,
			slots: [...coding.slots.slice(0, 2), { id: "terminal", kind: "gone.plugin/terminal" }],
		};
		const state = session([pane("old", "gone.plugin/terminal")]);

		const plan = planLayoutTemplate(template, state, kinds);

		expect(plan.skipped).toEqual(["terminal"]);
		expect(plan.opens.map((open) => open.slotId)).toEqual(["chat", "changes"]);
		expect(plan.extras.map((extra) => extra.id)).toEqual(["old"]);
	});
});

describe("building a template's layout", () => {
	it("keeps widths, pins, stacks and active panes, and puts extras in a column at the end", () => {
		const bySlot = new Map([
			["chat", pane("a", AGENT, "Chat")],
			["changes", pane("c", CHANGES, "Changes")],
			["terminal", pane("t", TERMINAL, "Terminal")],
		]);

		const layout = buildTemplateLayout(
			coding,
			bySlot,
			[pane("x", FILE, "notes.md")],
			kinds.layoutKindOf,
		);

		expect(layout.groups.map((group) => group.preferredWidth)).toEqual([450, 550, 550, 360]);
		expect(layout.groups.map((group) => group.pinned)).toEqual([true, false, false, false]);
		expect(layout.groups.map((group) => group.stackWeight)).toEqual([
			undefined,
			0.6,
			0.4,
			undefined,
		]);
		expect(layout.groups[1]?.stackId).toBe(layout.groups[2]?.stackId);
		expect(flattenPanes(layout).map((placed) => [placed.id, placed.kind])).toEqual([
			["a", "agent"],
			["c", "tool"],
			["t", "tool"],
			["x", "document"],
		]);
		expect(layout.activePaneId).toBe("a");
		expect(parseLayoutJson(serializeLayout(layout))).not.toBeNull();
	});

	it("drops a stack left with one group and falls back to the first group's active pane", () => {
		const layout = buildTemplateLayout(
			coding,
			new Map([["terminal", pane("t", TERMINAL)]]),
			[],
			kinds.layoutKindOf,
		);

		expect(layout.groups).toHaveLength(1);
		expect(layout.groups[0]).not.toHaveProperty("stackId");
		expect(layout.groups[0]).not.toHaveProperty("stackWeight");
		expect(layout.activePaneId).toBe("t");
	});

	it("rescales the weights of a stack that loses a group", () => {
		const template: LayoutTemplate = {
			...coding,
			slots: [...coding.slots, { id: "extra", kind: TERMINAL }],
			groups: [
				...coding.groups.slice(0, 1),
				{ ...coding.groups[1]!, stackWeight: 0.5 },
				{ ...coding.groups[2]!, stackWeight: 0.25 },
				{
					id: "third",
					tabs: ["extra"],
					activePaneId: "extra",
					width: 550,
					pinned: false,
					stackId: "right",
					stackWeight: 0.25,
				},
			],
		};

		const layout = buildTemplateLayout(
			template,
			new Map([
				["changes", pane("c", CHANGES)],
				["extra", pane("e", TERMINAL)],
			]),
			[],
			kinds.layoutKindOf,
		);

		expect(layout.groups.map((group) => group.stackWeight)).toEqual([0.5 / 0.75, 0.25 / 0.75]);
	});

	it("is empty when no slot has a pane", () => {
		expect(buildTemplateLayout(coding, new Map(), [], kinds.layoutKindOf)).toEqual({
			groups: [],
			activePaneId: "",
			sizes: {},
		});
	});
});

describe("applying a template", () => {
	it("opens missing panes in the background, then saves the layout and arrangement", async () => {
		const panes = fakePanes(session([pane("pty", TERMINAL, "Server")]));

		await applyLayoutTemplate(panes.handle, "s", { ...coding, arrangement: "carousel" }, kinds);

		expect(panes.open.mock.calls.map(([input]) => input)).toEqual([
			{ workSessionId: "s", kind: AGENT, activate: false },
			{ workSessionId: "s", kind: CHANGES, activate: false },
		]);
		const layout = parseLayoutJson(panes.state().layout)!;
		expect(flattenPanes(layout).map((placed) => placed.id)).toEqual(["new-1", "new-2", "pty"]);
		expect(flattenPanes(layout).find((placed) => placed.id === "pty")?.title).toBe("Server");
		expect(panes.state().activePaneId).toBe("new-1");
		expect(panes.setArrangement).toHaveBeenCalledWith({
			workSessionId: "s",
			arrangement: "carousel",
		});
	});

	it("round-trips: a captured template recreates its geometry and re-applies without opening", async () => {
		const source = fakePanes(EMPTY_WORK_SESSION_PANES);
		await applyLayoutTemplate(source.handle, "s", coding, kinds);
		const { template } = captureLayoutTemplate(source.state(), kinds);

		const target = fakePanes(EMPTY_WORK_SESSION_PANES);
		await applyLayoutTemplate(target.handle, "s", template, kinds);
		const restored = parseLayoutJson(target.state().layout)!;
		expect(restored.groups.map((group) => group.preferredWidth)).toEqual([450, 550, 550]);
		expect(restored.groups.map((group) => group.stackWeight)).toEqual([undefined, 0.6, 0.4]);
		expect(restored.groups.map((group) => group.pinned)).toEqual([true, false, false]);

		const layoutBefore = target.state().layout;
		target.open.mockClear();
		await applyLayoutTemplate(target.handle, "s", template, kinds);
		expect(target.open).not.toHaveBeenCalled();
		expect(target.state().layout).toBe(layoutBefore);
	});

	it("fills only the first slot of a singleton kind", async () => {
		const panes = fakePanes(EMPTY_WORK_SESSION_PANES, { singleton: AGENT });
		const template: LayoutTemplate = {
			version: 2,
			arrangement: "tiles",
			slots: [
				{ id: "a", kind: AGENT },
				{ id: "b", kind: AGENT },
			],
			groups: [
				{ id: "g1", tabs: ["a"], activePaneId: "a", width: 400, pinned: false },
				{ id: "g2", tabs: ["b"], activePaneId: "b", width: 400, pinned: false },
			],
		};

		await applyLayoutTemplate(panes.handle, "s", template, kinds);

		expect(panes.open).toHaveBeenCalledTimes(2);
		const layout = parseLayoutJson(panes.state().layout)!;
		expect(flattenPanes(layout).map((placed) => placed.id)).toEqual(["new-1"]);
	});

	it("saves no layout when nothing in the template can be placed", async () => {
		const panes = fakePanes(EMPTY_WORK_SESSION_PANES);

		await applyLayoutTemplate(
			panes.handle,
			"s",
			{ ...coding, slots: coding.slots.map((slot) => ({ ...slot, kind: "gone/x" })) },
			kinds,
		);

		expect(panes.open).not.toHaveBeenCalled();
		expect(panes.setLayout).not.toHaveBeenCalled();
		expect(panes.setArrangement).toHaveBeenCalled();
	});
});
