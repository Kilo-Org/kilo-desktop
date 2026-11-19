import { describe, expect, it } from "vitest";

import {
	AGENT_PANE_PREFERRED_WIDTH,
	ARRANGEMENTS,
	addPane,
	calculateGroupRects,
	calculateStackResize,
	createLayout,
	dropPositionFromPoint,
	findPaneGroup,
	flattenPanes,
	getScrollTarget,
	moveGroup,
	movePane,
	movePaneToGroup,
	PANE_GAP,
	parseLayoutJson,
	projectLayout,
	removePane,
	resizeColumn,
	resizeStackDivider,
	serializeLayout,
	setActivePane,
	togglePin,
	type PaneDescriptor,
} from "./layout.js";

function pane(id: string, kind: PaneDescriptor["kind"] = "agent"): PaneDescriptor {
	return { id, kind, title: id };
}

describe("pane groups", () => {
	it("creates one stable singleton group per pane", () => {
		const layout = createLayout([pane("chat"), pane("files", "document")]);

		expect(layout).toEqual({
			groups: [
				{
					id: "group:chat",
					tabs: [pane("chat")],
					activePaneId: "chat",
					preferredWidth: AGENT_PANE_PREFERRED_WIDTH,
					minWidth: 240,
					pinned: false,
				},
				{
					id: "group:files",
					tabs: [pane("files", "document")],
					activePaneId: "files",
					preferredWidth: 360,
					minWidth: 240,
					pinned: false,
				},
			],
			activePaneId: "chat",
			sizes: {},
		});
		expect(flattenPanes(layout).map((entry) => entry.id)).toEqual(["chat", "files"]);
	});

	it("inserts a pane at a requested index", () => {
		const layout = addPane(createLayout([pane("files", "document")]), pane("chat"), {
			index: 0,
		});
		expect(flattenPanes(layout).map((entry) => entry.id)).toEqual(["chat", "files"]);
	});

	it("adds panes as singleton groups and keeps local activity in sync", () => {
		let layout = addPane(createLayout([pane("chat")]), pane("files", "document"));
		layout = movePane(layout, "files", "group:chat", "inside");

		expect(layout.groups).toHaveLength(1);
		expect(layout.groups[0]?.tabs.map((entry) => entry.id)).toEqual(["chat", "files"]);
		expect(layout.groups[0]?.activePaneId).toBe("files");
		expect(layout.activePaneId).toBe("files");

		layout = setActivePane(layout, "chat");
		expect(layout.activePaneId).toBe("chat");
		expect(layout.groups[0]?.activePaneId).toBe("chat");
	});

	it("reorders tabs within a group and moves tabs between groups", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = movePaneToGroup(layout, "b", "group:a");
		layout = movePaneToGroup(layout, "c", "group:a", 0);
		layout = movePaneToGroup(layout, "a", "group:a", 2);

		expect(layout.groups.map((group) => group.id)).toEqual(["group:a"]);
		expect(layout.groups[0]?.tabs.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
		expect(layout.groups[0]?.activePaneId).toBe("a");
	});

	it("extracts one tab to an edge as a new singleton group", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = movePaneToGroup(layout, "b", "group:a");
		layout = movePane(layout, "b", "group:c", "before");

		expect(layout.groups.map((group) => group.tabs.map((entry) => entry.id))).toEqual([
			["a"],
			["b"],
			["c"],
		]);
		expect(findPaneGroup(layout, "b")?.id).toBe("group:b");
	});

	it("merges groups at center and moves whole groups across edges", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = moveGroup(layout, "group:b", "group:a", "inside");
		expect(layout.groups[0]?.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
		expect(layout.groups[0]?.activePaneId).toBe("b");
		expect(layout.activePaneId).toBe("b");

		layout = moveGroup(layout, "group:c", "group:a", "before");
		expect(layout.groups.map((group) => group.id)).toEqual(["group:c", "group:a"]);
		expect(layout.activePaneId).toBe("c");
	});

	it("preserves vertical ordering and resizes adjacent stack groups", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = moveGroup(layout, "group:c", "group:a", "below");
		layout = moveGroup(layout, "group:b", "group:a", "above");

		expect(layout.groups.map((group) => group.tabs[0]?.id)).toEqual(["b", "a", "c"]);
		expect(layout.groups.map((group) => group.stackId)).toEqual([
			"stack:group:a",
			"stack:group:a",
			"stack:group:a",
		]);

		const resized = resizeStackDivider(layout, "group:a", "group:c", 0.25);
		expect(findPaneGroup(resized, "a")?.stackWeight).toBeCloseTo(0.1875);
		expect(findPaneGroup(resized, "c")?.stackWeight).toBeCloseTo(0.5625);
	});

	it("removes empty groups and selects sane local and session fallbacks", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = movePaneToGroup(layout, "b", "group:a");
		layout = setActivePane(layout, "b");
		layout = removePane(layout, "b");

		expect(layout.groups[0]?.tabs.map((entry) => entry.id)).toEqual(["a"]);
		expect(layout.groups[0]?.activePaneId).toBe("a");
		expect(layout.activePaneId).toBe("a");

		layout = removePane(layout, "a");
		expect(layout.groups.map((group) => group.id)).toEqual(["group:c"]);
		expect(layout.activePaneId).toBe("c");
	});
});

describe("column behavior", () => {
	it("pins and resizes every group in a vertical column", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = moveGroup(layout, "group:b", "group:a", "below");
		layout = togglePin(layout, "group:b");
		layout = resizeColumn(layout, "group:a", 620);

		expect(layout.groups.filter((group) => group.stackId).map((group) => group.pinned)).toEqual([
			true,
			true,
		]);
		expect(layout.sizes).toMatchObject({ "group:a": 620, "group:b": 620 });
		expect(layout.sizes["group:c"]).toBeUndefined();
	});
});

describe("projection", () => {
	it("exposes only tiles and carousel arrangements", () => {
		expect(ARRANGEMENTS).toEqual(["tiles", "carousel"]);
	});

	it("tiles fits every column proportionally even below minimum widths", () => {
		const layout = createLayout([pane("a"), pane("b"), pane("c")]);
		const projected = projectLayout(layout, "tiles", 308);

		expect(projected.groups.map((group) => group.pane.id)).toEqual(["a", "b", "c"]);
		expect(projected.overflowIds).toEqual([]);
		expect(projected.columns.map((column) => column.width)).toEqual([100, 100, 100]);
		expect(
			projected.columns.reduce((total, column) => total + column.width, 0) +
				(projected.columns.length - 1) * PANE_GAP,
		).toBe(308);
	});

	it("carousel uses stored or preferred column widths and projects one active tab per group", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = movePaneToGroup(layout, "b", "group:a");
		layout = resizeColumn(layout, "group:a", 640);
		const projected = projectLayout(layout, "carousel", 200);

		expect(projected.groups.map((group) => group.pane.id)).toEqual(["b", "c"]);
		expect(projected.columns.map((column) => column.width)).toEqual([640, 480]);
		expect(projected.groups[0]?.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
	});
});

describe("geometry and persistence", () => {
	it("maps pane and group centers to inside while tabs remain before or after", () => {
		const rect = { left: 0, top: 0, width: 400, height: 200 };

		expect(dropPositionFromPoint("pane", 200, 100, rect)).toBe("inside");
		expect(dropPositionFromPoint("group", 200, 100, rect)).toBe("inside");
		expect(dropPositionFromPoint("pane", 10, 100, rect)).toBe("before");
		expect(dropPositionFromPoint("pane", 200, 10, rect)).toBe("above");
		expect(dropPositionFromPoint("tab", 10, 100, rect)).toBe("before");
		expect(dropPositionFromPoint("tab", 390, 100, rect)).toBe("after");
	});

	it("calculates one horizontal rectangle per group column", () => {
		let layout = createLayout([pane("a"), pane("b"), pane("c")]);
		layout = moveGroup(layout, "group:b", "group:a", "below");

		expect(calculateGroupRects(layout, 20).map(({ id, x }) => ({ id, x }))).toEqual([
			{ id: "group:a", x: 20 },
			{ id: "group:b", x: 20 },
			{ id: "group:c", x: 504 },
		]);
	});

	it("preserves stack and scrolling geometry calculations", () => {
		expect(
			calculateStackResize({
				columnHeight: 400,
				paneCount: 2,
				upperHeight: 200,
				lowerHeight: 196,
				deltaY: 80,
			}),
		).toEqual({ upperHeight: 276, lowerHeight: 120, minimumHeight: 120 });
		expect(
			getScrollTarget({
				group: { id: "group:a", x: 878, width: 520, right: 1398 },
				scrollLeft: 0,
				viewportWidth: 1200,
				occludedLeft: 420,
			}),
		).toBe(202);
		expect(
			getScrollTarget({
				group: { id: "group:a", x: 10, width: 100, right: 110 },
				scrollLeft: 100,
				viewportWidth: 500,
				occludedLeft: 20,
			}),
		).toBe(0);
		expect(
			getScrollTarget({
				group: { id: "group:a", x: 200, width: 100, right: 300 },
				scrollLeft: 100,
				viewportWidth: 500,
				occludedLeft: 20,
			}),
		).toBe(100);
		expect(
			calculateStackResize({
				columnHeight: Number.NaN,
				paneCount: 0,
				upperHeight: Number.NaN,
				lowerHeight: Number.NaN,
				deltaY: Number.NaN,
				gap: Number.NaN,
			}),
		).toEqual({ upperHeight: 0, lowerHeight: 0, minimumHeight: 0 });
	});

	it("handles no-op mutations and edge drop positions without corrupting layout", () => {
		const layout = createLayout([pane("a"), pane("b")]);

		expect(createLayout([]).activePaneId).toBe("");
		expect(setActivePane(layout, "missing")).toBe(layout);
		expect(removePane(layout, "missing")).toBe(layout);
		expect(movePane(layout, "missing", "group:b", "inside")).toBe(layout);
		expect(movePane(layout, "a", "missing", "inside")).toBe(layout);
		expect(moveGroup(layout, "group:a", "group:a", "inside")).toBe(layout);
		expect(togglePin(layout, "missing")).toBe(layout);
		expect(resizeColumn(layout, "missing", 400)).toBe(layout);
		expect(resizeColumn(layout, "group:a", Number.NaN)).toBe(layout);
		expect(resizeStackDivider(layout, "group:a", "group:b", 0)).toBe(layout);
		expect(resizeStackDivider(layout, "group:a", "group:b", 0.5)).toBe(layout);

		const rect = { left: 0, top: 0, width: 400, height: 200 };
		expect(dropPositionFromPoint("pane", 390, 100, rect)).toBe("after");
		expect(dropPositionFromPoint("group", 200, 190, rect)).toBe("below");
	});

	it("updates an existing pane and moves a pane beside another", () => {
		const initial = createLayout([pane("a"), pane("b")]);
		const updated = addPane(initial, { ...pane("a"), title: "Updated" });
		expect(findPaneGroup(updated, "a")?.tabs[0]?.title).toBe("Updated");
		expect(updated.activePaneId).toBe("a");

		const moved = movePane(initial, "a", "group:b", "after");
		expect(moved.groups.map((group) => group.tabs[0]?.id)).toEqual(["b", "a"]);
	});

	it("round-trips only the explicit nested group schema", () => {
		let layout = createLayout([pane("a"), pane("b")]);
		layout = movePaneToGroup(layout, "b", "group:a");
		layout = togglePin(layout, "group:a");

		expect(parseLayoutJson(serializeLayout(layout))).toEqual(layout);
		expect(parseLayoutJson("{not json")).toBeNull();
		expect(
			parseLayoutJson({
				panes: [pane("a")],
				activePaneId: "a",
				sizes: {},
			}),
		).toBeNull();
	});
});
