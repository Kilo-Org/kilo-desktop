import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createLayout, getPaneColumns, movePane } from "@anaconda-agentic-desktop/pane-layout";
import { renderDragCanvas, startPaneDrag } from "./test-helpers.js";

beforeEach(async () => {
	await page.viewport(1100, 700);
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});
afterEach(cleanup);

it.each(["agent", "files"])(
	"moves $0 into a full-height column at the right edge",
	async (sourceId) => {
		const initial = createLayout([
			{ id: "agent", kind: "agent", title: "Chat" },
			{ id: "files", kind: "document", title: "Files" },
			{ id: "notes", kind: "document", title: "Notes" },
		]);
		const stacked = movePane(initial, "notes", "group:files", "below");
		const { baseElement, commit } = renderDragCanvas(stacked, { arrangement: "tiles" });
		const canvas = baseElement.querySelector<HTMLElement>("[data-qa-id='kilo-chat-pane-canvas']")!;
		const source = baseElement.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-tab-${sourceId}']`,
		)!;
		const editor = baseElement.querySelector(`textarea[aria-label='${sourceId}']`);
		const box = canvas.getBoundingClientRect();
		const lowerStrip = baseElement
			.querySelector<HTMLElement>("[data-pane-group-tabs='group:notes']")!
			.getBoundingClientRect();
		const { move, drop } = startPaneDrag(source);
		for (const y of [lowerStrip.top + 14, box.top + 18, box.bottom - 12]) {
			move(box.right - 8, y);
			const preview = baseElement.querySelector<HTMLElement>(
				"[data-qa-id='chat-pane-drop-preview']",
			)!;
			expect(preview).toBeTruthy();
			await vi.waitFor(() => {
				expect(preview.getBoundingClientRect().top).toBeCloseTo(box.top, 0);
				expect(preview.getBoundingClientRect().height).toBeCloseTo(box.height, 0);
			});
			expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
			expect(baseElement.querySelector(`textarea[aria-label='${sourceId}']`)).toBe(editor);
		}
		expect(commit).not.toHaveBeenCalled();
		drop();
		expect(commit).toHaveBeenCalledOnce();
		const columns = getPaneColumns(commit.mock.calls[0]![0].groups);
		expect(columns.at(-1)!.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
			[sourceId],
		]);
		await vi.waitFor(() => {
			const final = baseElement
				.querySelector<HTMLElement>(`[data-pane-group-id='group:${sourceId}']`)!
				.getBoundingClientRect();
			expect(final.height).toBeCloseTo(box.height, 0);
		});
		expect(baseElement.querySelector("[data-drop-neighbor]")).toBeNull();
	},
);

it.each([
	["agent", "before"],
	["files", "after"],
] as const)(
	"previews %s beside the entire carousel stack on the %s side",
	async (sourceId, side) => {
		const initial = createLayout(
			[
				{ id: "files", kind: "document", title: "Files" },
				{ id: "agent", kind: "agent", title: "Chat" },
			],
			sourceId,
		);
		const stacked = movePane(initial, "agent", "group:files", "below");
		const { baseElement, commit } = renderDragCanvas(stacked, { arrangement: "carousel" });
		const column = baseElement.querySelector<HTMLElement>("[data-column-id]")!;
		const groups = [...column.querySelectorAll<HTMLElement>("[data-pane-group-id]")];
		const box = column.getBoundingClientRect();
		const source = baseElement.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-tab-${sourceId}']`,
		)!;
		const editor = baseElement.querySelector(`textarea[aria-label='${sourceId}']`);
		const { move, drop } = startPaneDrag(source);
		const canvas = baseElement
			.querySelector<HTMLElement>("[data-qa-id='kilo-chat-pane-canvas']")!
			.getBoundingClientRect();
		const blankWidth = canvas.right - box.right;
		expect(blankWidth).toBeGreaterThan(100);
		const positions =
			side === "before"
				? [0.25, 0.75, 0.5, 0.25].map((fraction) => ({
						x: box.left + 10,
						y: box.top + box.height * fraction,
					}))
				: [
						{ x: box.right + blankWidth / 2, y: box.top + box.height / 2 },
						{ x: box.right + 5, y: box.top + 2 },
						{ x: canvas.right - 40, y: box.bottom - 2 },
						{ x: box.right - 10, y: box.top + box.height / 4 },
						{ x: box.right + blankWidth / 3, y: box.top + box.height * 0.75 },
					];
		let firstPreview: HTMLElement | null = null;
		for (const { x, y } of positions) {
			move(x, y);
			const preview = baseElement.querySelector<HTMLElement>(
				"[data-qa-id='chat-pane-drop-preview']",
			)!;
			expect(preview).toBeTruthy();
			if (firstPreview) expect(preview).toBe(firstPreview);
			firstPreview = preview;
			await vi.waitFor(() => {
				const slot = preview.getBoundingClientRect();
				expect(slot.top).toBeCloseTo(box.top, 0);
				expect(slot.bottom).toBeCloseTo(box.bottom, 0);
				expect(side === "before" ? slot.left : slot.right).toBeCloseTo(
					side === "before" ? box.left : box.right,
					0,
				);
				for (const group of groups) {
					const content = group
						.querySelector<HTMLElement>("[data-qa-id='chat-pane-frame']")!
						.getBoundingClientRect();
					expect(side === "before" ? content.left >= slot.right : content.right <= slot.left).toBe(
						true,
					);
				}
			});
			expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-drop-preview']")).toHaveLength(1);
			expect(baseElement.querySelector(`textarea[aria-label='${sourceId}']`)).toBe(editor);
		}
		drop();
		expect(commit).toHaveBeenCalledOnce();
		const columns = getPaneColumns(commit.mock.calls[0]![0].groups);
		expect(columns).toHaveLength(2);
		expect(columns[side === "before" ? 0 : 1]!.groups[0]!.tabs[0]!.id).toBe(sourceId);
		await vi.waitFor(() => {
			const final = baseElement
				.querySelector<HTMLElement>(`[data-pane-group-id='group:${sourceId}']`)!
				.getBoundingClientRect();
			expect(final.height).toBeCloseTo(box.height, 0);
		});
		expect(baseElement.querySelector("[data-drop-neighbor]")).toBeNull();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
	},
);

it.each([false, true])(
	"keeps a full-height shared slot beside a stacked neighbor (left stacked: %s)",
	async (stackLeft) => {
		let layout = createLayout([
			{ id: "agent", kind: "agent", title: "Chat" },
			{ id: "files", kind: "document", title: "Files" },
			{ id: "notes", kind: "document", title: "Notes" },
			...(stackLeft ? [{ id: "extra", kind: "document" as const, title: "Extra" }] : []),
		]);
		layout = movePane(layout, "notes", "group:files", "below");
		if (stackLeft) layout = movePane(layout, "extra", "group:agent", "below");
		const { baseElement, commit } = renderDragCanvas(layout, {
			arrangement: "carousel",
			width: 1400,
		});
		await page.viewport(1500, 700);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const columns = [...baseElement.querySelectorAll<HTMLElement>("[data-column-id]")];
		const left = columns[0]!.getBoundingClientRect();
		const right = columns[1]!.getBoundingClientRect();
		const source = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-tab-notes']")!;
		const { move, drop } = startPaneDrag(source);
		move(right.left + 15, right.top + right.height / 4);
		const preview = baseElement.querySelector<HTMLElement>(
			"[data-qa-id='chat-pane-drop-preview']",
		)!;
		await vi.waitFor(() => {
			const slot = preview.getBoundingClientRect();
			expect(slot.top).toBeCloseTo(left.top, 0);
			expect(slot.bottom).toBeCloseTo(left.bottom, 0);
			expect(slot.left).toBeLessThan(left.right);
			expect(slot.right).toBeGreaterThan(right.left);
			for (const [index, column] of columns.entries()) {
				for (const content of column.querySelectorAll<HTMLElement>(
					"[data-qa-id='chat-pane-frame']",
				)) {
					const box = content.getBoundingClientRect();
					expect(index === 0 ? box.right <= slot.left : box.left >= slot.right).toBe(true);
				}
			}
		});
		move(left.right - 15, left.top + left.height * 0.75);
		expect(baseElement.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBe(preview);
		drop();
		expect(commit).toHaveBeenCalledOnce();
		expect(getPaneColumns(commit.mock.calls[0]![0].groups)[1]!.groups[0]!.tabs[0]!.id).toBe(
			"notes",
		);
		expect(baseElement.querySelector("[data-drop-neighbor]")).toBeNull();
	},
);
