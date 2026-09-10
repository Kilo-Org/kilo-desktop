import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { createLayout, movePaneToGroup } from "@anaconda-agentic-desktop/pane-layout";

import { renderDragCanvas, startPaneDrag } from "./test-helpers.js";

beforeEach(async () => {
	await page.viewport(1100, 700);
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});
afterEach(cleanup);

function renderDrag({
	topPadding = 0,
	tabs = "left",
}: { topPadding?: number; tabs?: "left" | "right" | "single" } = {}) {
	const initial = createLayout(
		[
			{ id: "agent", kind: "agent", title: "Chat" },
			{ id: "notes", kind: "document", title: "Notes" },
			{ id: "files", kind: "document", title: "Files" },
		],
		"files",
	);
	const layout =
		tabs === "single"
			? createLayout(
					initial.groups.flatMap((group) => group.tabs).filter((tab) => tab.id !== "notes"),
					"files",
				)
			: movePaneToGroup(initial, "notes", tabs === "right" ? "group:files" : "group:agent");
	const { baseElement, commit } = renderDragCanvas(layout, { topPadding });
	const source = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-tab-files']")!;
	const group = baseElement.querySelector<HTMLElement>("[data-pane-group-id='group:agent']")!;
	const strip = group.querySelector<HTMLElement>("[data-qa-id='chat-pane-tabs']")!;
	const notes = group.querySelector<HTMLElement>("[data-pane-tab='notes']")!;
	const { move, drop } = startPaneDrag(source);
	return { group, strip, notes, move, drop, commit };
}

describe("pane tab drop targets", () => {
	it.each([0, 4])(
		"accepts the empty tab strip with %s pixels of vertical overshoot",
		(overshoot) => {
			const { group, strip, notes, move, drop, commit } = renderDrag();
			const box = strip.getBoundingClientRect();
			move(box.right - 20, overshoot ? box.bottom + overshoot : box.top + box.height / 2);
			expect(notes).toHaveAttribute("data-drop-zone", "after");
			expect(group).not.toHaveAttribute("data-drop-zone");
			drop();
			expect(commit).toHaveBeenCalledOnce();
			const result = commit.mock.calls[0]![0];
			expect(result.groups).toHaveLength(1);
			expect(result.groups[0]!.tabs.map((tab) => tab.id)).toEqual(["agent", "notes", "files"]);
		},
	);

	it("offers both insertion positions when dragging across a single-tab strip", async () => {
		const { group, strip, move, drop, commit } = renderDrag({ tabs: "single" });
		const tab = group.querySelector<HTMLElement>("[data-pane-tab='agent']")!;
		const row = strip.getBoundingClientRect();
		const box = tab.getBoundingClientRect();
		move(row.right - 12, row.top + row.height / 2);
		expect(tab).toHaveAttribute("data-drop-zone", "after");
		const preview = strip.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
		await vi.waitFor(() => expect(preview.getBoundingClientRect().width).toBeGreaterThan(20));
		const slot = preview.getBoundingClientRect();
		for (const x of [slot.left + slot.width / 2, box.right - 2]) {
			move(x, row.top + row.height / 2);
			expect(tab).toHaveAttribute("data-drop-zone", "after");
			expect(strip.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
			expect(preview.getBoundingClientRect().left).toBeCloseTo(slot.left, 0);
		}
		move(row.left + 1, row.top + row.height / 2);
		expect(tab).toHaveAttribute("data-drop-zone", "before");
		drop();
		const result = commit.mock.calls[0]![0];
		expect(result.groups).toHaveLength(1);
		expect(result.groups[0]!.tabs.map((tab) => tab.id)).toEqual(["files", "agent"]);
	});

	it.each(["left", "right"] as const)(
		"keeps the shared middle slot fixed when approaching from the %s",
		async (side) => {
			const { group: left, move, drop, commit } = renderDrag({ tabs: "right" });
			const right = document.querySelector<HTMLElement>("[data-pane-group-id='group:files']")!;
			const leftBox = left.getBoundingClientRect();
			const rightBox = right.getBoundingClientRect();
			const y = leftBox.top + leftBox.height / 2;
			move(side === "right" ? rightBox.left + 30 : leftBox.right - 30, y);
			expect(left).toHaveAttribute("data-drop-zone", "after");
			expect(right).not.toHaveAttribute("data-drop-zone");
			const preview = left.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
			await vi.waitFor(() => expect(preview.getBoundingClientRect().width).toBeGreaterThan(50));
			const slot = preview.getBoundingClientRect();
			expect(slot.left).toBeLessThan(leftBox.right);
			expect(slot.right).toBeGreaterThan(rightBox.left);
			expect(right).toHaveAttribute("data-drop-neighbor", "before");
			for (const x of [
				rightBox.left + 10,
				(leftBox.right + rightBox.left) / 2,
				leftBox.right - 20,
				rightBox.left + 35,
			]) {
				move(x, y);
				expect(left.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
				expect(right).not.toHaveAttribute("data-drop-zone");
				expect(preview.getBoundingClientRect().left).toBeCloseTo(slot.left, 0);
				expect(preview.getBoundingClientRect().width).toBeCloseTo(slot.width, 0);
				expect(document.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
			}
			drop();
			expect(right).not.toHaveAttribute("data-drop-neighbor");
			expect(right.style.getPropertyValue("--pane-drop-space")).toBe("");
			const result = commit.mock.calls[0]![0];
			expect(result.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
				["agent"],
				["files"],
				["notes"],
			]);
		},
	);

	it("does not offer a middle split that leaves a single-tab right pane where it already is", () => {
		const { group: left, move, drop, commit } = renderDrag({ tabs: "single" });
		const right = document.querySelector<HTMLElement>("[data-pane-group-id='group:files']")!;
		const leftBox = left.getBoundingClientRect();
		const rightBox = right.getBoundingClientRect();
		const y = leftBox.top + leftBox.height / 2;
		for (const x of [rightBox.left + 30, leftBox.right - 30, (rightBox.left + leftBox.right) / 2]) {
			move(x, y);
			expect(document.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
			expect(left).not.toHaveAttribute("data-drop-zone");
			expect(right).not.toHaveAttribute("data-drop-neighbor");
		}
		drop();
		expect(commit).not.toHaveBeenCalled();
	});

	it("switches between the upper gap and tab row without requiring extra movement", async () => {
		const { group, strip, notes, move, drop, commit } = renderDrag({ topPadding: 64 });
		const row = strip.getBoundingClientRect();
		const x = row.right - 20;
		move(x, row.top + 1);
		expect(notes).toHaveAttribute("data-drop-zone", "after");
		for (let pass = 0; pass < 2; pass++) {
			move(x, row.top - 2);
			expect(group).toHaveAttribute("data-drop-zone", "above");
			expect(notes).not.toHaveAttribute("data-drop-zone");
			await vi.waitFor(() =>
				expect(strip.getBoundingClientRect().top).toBeGreaterThan(row.top + 100),
			);
			move(x, row.top + 1);
			expect(group).not.toHaveAttribute("data-drop-zone");
			expect(notes).toHaveAttribute("data-drop-zone", "after");
			expect(document.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
		}
		drop();
		expect(commit).toHaveBeenCalledOnce();
		expect(commit.mock.calls[0]![0].groups).toHaveLength(1);
	});

	it("adds to the group below its tab strip", () => {
		const { group, strip, move, drop, commit } = renderDrag();
		const box = group.getBoundingClientRect();
		move(box.left + box.width / 2, strip.getBoundingClientRect().bottom + 24);
		expect(group).toHaveAttribute("data-drop-zone", "inside");
		expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")?.textContent).toContain(
			"Add to tab group",
		);
		drop();
		expect(commit).toHaveBeenCalledOnce();
		expect(commit.mock.calls[0]![0].groups).toHaveLength(1);
		expect(commit.mock.calls[0]![0].groups[0]!.tabs.map((tab) => tab.id)).toEqual([
			"agent",
			"notes",
			"files",
		]);
	});

	it("leaves an upper split when dragging below the original tab strip", async () => {
		const { group, strip, move, drop, commit } = renderDrag();
		const box = group.getBoundingClientRect();
		const row = strip.getBoundingClientRect();
		const x = box.left + box.width / 2;
		move(x, (box.top + row.top) / 2);
		expect(group).toHaveAttribute("data-drop-zone", "above");
		await vi.waitFor(() =>
			expect(strip.getBoundingClientRect().top).toBeGreaterThan(row.top + 100),
		);
		move(x, row.bottom + 12);
		expect(group).toHaveAttribute("data-drop-zone", "inside");
		expect(document.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
		drop();
		expect(commit.mock.calls[0]![0].groups).toHaveLength(1);
	});

	it.each(["original", "shifted"] as const)(
		"leaves a top split when dragging onto the %s tab row",
		async (row) => {
			const { group, strip, move, drop, commit } = renderDrag({ topPadding: 64 });
			const original = strip.getBoundingClientRect();
			const box = group.getBoundingClientRect();
			move(box.left + box.width / 2, box.top - 24);
			expect(group).toHaveAttribute("data-drop-zone", "above");
			await vi.waitFor(() =>
				expect(strip.getBoundingClientRect().top).toBeGreaterThan(original.top + 100),
			);
			const targetRow = row === "original" ? original : strip.getBoundingClientRect();
			move(targetRow.right - 20, targetRow.top + targetRow.height / 2);
			expect(group).not.toHaveAttribute("data-drop-zone");
			expect(group.querySelector("[data-pane-tab][data-drop-zone='after']")).toBeTruthy();
			drop();
			expect(commit.mock.calls[0]![0].groups).toHaveLength(1);
		},
	);

	it.each([2, 52])("offers a split %s pixels above the canvas", (overshoot) => {
		const { group, move, drop, commit } = renderDrag({ topPadding: 64 });
		const box = group.getBoundingClientRect();
		move(box.left + box.width / 2, box.top - overshoot);
		expect(group).toHaveAttribute("data-drop-zone", "above");
		expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")?.textContent).toContain(
			"Split here",
		);
		drop();
		expect(commit).toHaveBeenCalledOnce();
		const result = commit.mock.calls[0]![0];
		const moved = result.groups.find((entry) => entry.tabs.some((tab) => tab.id === "files"));
		const target = result.groups.find((entry) => entry.id === "group:agent");
		expect(moved?.stackId).toBeTruthy();
		expect(moved?.stackId).toBe(target?.stackId);
		expect(result.groups.indexOf(moved!)).toBeLessThan(result.groups.indexOf(target!));
	});

	it("clears the preview when leaving the extended top edge", () => {
		const { group, move, drop, commit } = renderDrag({ topPadding: 80 });
		const box = group.getBoundingClientRect();
		move(box.left + box.width / 2, box.top - 24);
		expect(group).toHaveAttribute("data-drop-zone", "above");
		move(box.left + box.width / 2, box.top - 65);
		expect(group).not.toHaveAttribute("data-drop-zone");
		drop();
		expect(commit).not.toHaveBeenCalled();
	});

	it.each(["before", "after", "above", "below"] as const)(
		"keeps one %s split slot while the pointer moves through it",
		async (position) => {
			const { group, strip, move, drop, commit } = renderDrag({ tabs: "right" });
			const box = group.getBoundingClientRect();
			const x =
				position === "before"
					? box.left + 2
					: position === "after"
						? box.right - 2
						: box.left + box.width / 2;
			const y =
				position === "above"
					? (box.top + strip.getBoundingClientRect().top) / 2
					: position === "below"
						? box.bottom - 2
						: box.top + box.height / 2;
			move(x, y);
			expect(group).toHaveAttribute("data-drop-zone", position);
			const preview = group.querySelector<HTMLElement>("[data-qa-id='chat-pane-drop-preview']")!;
			await vi.waitFor(() => expect(preview.getBoundingClientRect().height).toBeGreaterThan(50));
			const slot = preview.getBoundingClientRect();
			for (const nextY of [
				slot.top + slot.height / 2,
				slot.top + (position === "above" ? 100 : 18),
				slot.bottom - 18,
			]) {
				move(slot.left + slot.width / 2, nextY);
				expect(group).toHaveAttribute("data-drop-zone", position);
				expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
				expect(document.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
				expect(group.querySelector("[data-pane-tab][data-drop-zone]")).toBeNull();
			}
			drop();
			expect(commit).toHaveBeenCalledOnce();
			expect(commit.mock.calls[0]![0].groups).toHaveLength(3);
		},
	);

	it("ignores small movements across a split boundary but switches on deliberate movement", () => {
		const { group, move, drop, commit } = renderDrag();
		const box = group.getBoundingClientRect();
		const boundary = Math.min(92, Math.max(40, box.width * 0.22));
		const y = box.top + box.height / 2;
		move(box.left + boundary + 2, y);
		const preview = group.querySelector("[data-qa-id='chat-pane-drop-preview']");
		for (const delta of [-2, 3, -4, 1, -5]) {
			move(box.left + boundary + delta, y);
			expect(group).toHaveAttribute("data-drop-zone", "inside");
			expect(group.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
		}
		move(box.left + boundary - 20, y);
		expect(group).toHaveAttribute("data-drop-zone", "before");
		drop();
		expect(commit.mock.calls[0]![0].groups).toHaveLength(2);
	});
});
