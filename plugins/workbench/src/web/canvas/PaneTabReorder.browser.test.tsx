import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createLayout, movePaneToGroup } from "@kilo-desktop/pane-layout";
import { renderDragCanvas, startPaneDrag } from "./test-helpers";

beforeEach(async () => {
	await page.viewport(1200, 700);
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});
afterEach(cleanup);

it("reorders tabs with native pointer capture and commits only once", async () => {
	const initial = createLayout([
		{ id: "agent", kind: "agent", title: "Chat" },
		{ id: "notes", kind: "document", title: "Notes" },
		{ id: "files", kind: "document", title: "Files" },
	]);
	const grouped = movePaneToGroup(
		movePaneToGroup(initial, "notes", "group:agent"),
		"files",
		"group:agent",
	);
	const { baseElement, commit } = renderDragCanvas(grouped);
	const screen = page.elementLocator(baseElement);
	const source = screen.getByTestId("chat-pane-tab-files");
	const captured = vi.fn();
	source.element().addEventListener("gotpointercapture", captured);

	await source.dropTo(screen.getByTestId("chat-pane-tab-agent"), {
		targetPosition: { x: 2, y: 14 },
	});

	expect(captured).toHaveBeenCalledOnce();
	expect(commit).toHaveBeenCalledOnce();
	expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((tab) => tab.id)).toEqual([
		"files",
		"agent",
		"notes",
	]);
	expect(baseElement.querySelector("[data-tab-reordering]")).toBeNull();
	expect(document.querySelector("[data-qa-id='chat-pane-drag-preview']")).toBeNull();
	expect(baseElement.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
});

function setup(sourceId: string) {
	let initial = createLayout(
		[
			{ id: "agent", kind: "agent", title: "Chat" },
			{ id: "notes", kind: "document", title: "A longer notes tab" },
			{ id: "files", kind: "document", title: "Files" },
			{ id: "external", kind: "document", title: "New document" },
		],
		sourceId,
	);
	initial = movePaneToGroup(initial, "notes", "group:agent");
	initial = movePaneToGroup(initial, "files", "group:agent");
	const { baseElement, commit } = renderDragCanvas(initial, { width: 1150 });
	const group = baseElement.querySelector<HTMLElement>("[data-pane-group-id='group:agent']")!;
	const strip = group.querySelector<HTMLElement>("[data-pane-group-tabs]")!;
	const source = baseElement.querySelector<HTMLElement>(
		`[data-qa-id='chat-pane-tab-${sourceId}']`,
	)!;
	const tab = (id: string) => group.querySelector<HTMLElement>(`[data-pane-tab='${id}']`)!;
	const editor = baseElement.querySelector(`textarea[aria-label='${sourceId}']`);
	const drag = startPaneDrag(source);
	const y = strip.getBoundingClientRect().top + 14;
	const move = (x: number) => drag.move(x, y);
	const { drop } = drag;
	return { baseElement, group, strip, source, tab, editor, move, drop, commit };
}

it.each([1, 3])("previews and inserts an external tab at index %s", async (index) => {
	const { group, strip, tab, move, drop, commit } = setup("external");
	const ids = ["agent", "notes", "files"];
	const anchor = tab(ids[Math.min(index, 2)]!);
	const rect = anchor.getBoundingClientRect();
	move(index === 3 ? strip.getBoundingClientRect().right - 10 : rect.left + 2);
	expect(anchor).toHaveAttribute("data-drop-zone", index === 3 ? "after" : "before");
	const preview = group.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
	await vi.waitFor(() => {
		const slot = preview.getBoundingClientRect();
		const box = anchor.getBoundingClientRect();
		expect(index === 3 ? slot.left >= box.right : slot.right <= box.left).toBe(true);
		expect(slot.width).toBeGreaterThan(50);
	});
	drop();
	ids.splice(index, 0, "external");
	expect(commit).toHaveBeenCalledOnce();
	expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((entry) => entry.id)).toEqual(ids);
});

it.each([
	["agent", "files", "after", ["notes", "files", "agent"]],
	["agent", "files", "before", ["notes", "agent", "files"]],
	["files", "agent", "before", ["files", "agent", "notes"]],
] as const)(
	"reorders %s %s %s with the preview replacing its old slot",
	async (sourceId, targetId, position, expected) => {
		const { baseElement, group, tab, editor, move, drop, commit } = setup(sourceId);
		const target = tab(targetId);
		const box = target.getBoundingClientRect();
		move(position === "before" ? box.left + 2 : box.right - 2);
		expect(target).toHaveAttribute("data-drop-zone", position);
		expect(tab(sourceId)).toHaveAttribute("data-tab-reordering", "true");
		const preview = group.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
		await vi.waitFor(() => expect(preview.getBoundingClientRect().width).toBeGreaterThan(50));
		const slot = preview.getBoundingClientRect();
		move(slot.left + slot.width / 2);
		expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
		expect(baseElement.querySelector(`textarea[aria-label='${sourceId}']`)).toBe(editor);
		drop();
		expect(commit).toHaveBeenCalledOnce();
		expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((entry) => entry.id)).toEqual(expected);
		expect(
			[...group.querySelectorAll<HTMLElement>("[data-pane-tab]")].map(
				(entry) => entry.dataset.paneTab,
			),
		).toEqual(expected);
		expect(group.querySelector("[data-tab-reordering]")).toBeNull();
	},
);

it("restores the original strip and content after cancelling a reorder", () => {
	const { group, tab, move, commit } = setup("files");
	move(tab("agent").getBoundingClientRect().left + 2);
	expect(tab("files")).toHaveAttribute("data-tab-reordering", "true");
	fireEvent.keyDown(window, { key: "Escape" });
	expect(commit).not.toHaveBeenCalled();
	expect(group.querySelector("[data-tab-reordering]")).toBeNull();
	expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
	expect(
		[...group.querySelectorAll<HTMLElement>("[data-pane-tab]")].map(
			(entry) => entry.dataset.paneTab,
		),
	).toEqual(["agent", "notes", "files"]);
});

it("moves an external preview through every gap in both directions", async () => {
	const { group, tab, strip, move, drop, commit } = setup("external");
	for (const [id, position] of [
		["agent", "before"],
		["notes", "before"],
		["files", "before"],
		["files", "after"],
		["notes", "before"],
		["agent", "before"],
	] as const) {
		const target = tab(id);
		const box = target.getBoundingClientRect();
		const visibleRight = Math.min(box.right, strip.getBoundingClientRect().right);
		move(position === "before" ? box.left + 2 : visibleRight - 2);
		expect(target).toHaveAttribute("data-drop-zone", position);
		expect(group.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
		const preview = strip.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
		await vi.waitFor(() => expect(preview.getBoundingClientRect().width).toBeGreaterThan(50));
	}
	drop();
	expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((entry) => entry.id)).toEqual([
		"external",
		"agent",
		"notes",
		"files",
	]);
});

it.each(["agent", "files"])(
	"can return %s to its original slot without a layout change",
	(sourceId) => {
		const { group, tab, move, drop, commit } = setup(sourceId);
		const first = sourceId === "agent";
		const opposite = tab(first ? "files" : "agent").getBoundingClientRect();
		move(first ? opposite.right - 2 : opposite.left + 2);
		expect(tab(sourceId)).toHaveAttribute("data-tab-reordering", "true");
		const originalNeighbor = tab("notes").getBoundingClientRect();
		move(first ? originalNeighbor.left + 2 : originalNeighbor.right - 2);
		expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
		expect(group.querySelector("[data-tab-reordering]")).toBeNull();
		drop();
		expect(commit).not.toHaveBeenCalled();
	},
);

it("scrolls a narrow strip to reach the last and first insertion gaps", async () => {
	const { group, strip, tab, move, drop, commit } = setup("external");
	strip.style.maxWidth = "220px";
	const box = strip.getBoundingClientRect();
	move(box.right - 2);
	await vi.waitFor(
		() => {
			expect(strip.scrollLeft).toBeGreaterThan(0);
			expect(tab("files")).toHaveAttribute("data-drop-zone", "after");
		},
		{ timeout: 3000 },
	);
	move(box.left + 2);
	await vi.waitFor(
		() => {
			expect(strip.scrollLeft).toBe(0);
			expect(tab("agent")).toHaveAttribute("data-drop-zone", "before");
		},
		{ timeout: 3000 },
	);
	expect(group.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
	drop();
	expect(commit).toHaveBeenCalledOnce();
	expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((entry) => entry.id)).toEqual([
		"external",
		"agent",
		"notes",
		"files",
	]);
});
