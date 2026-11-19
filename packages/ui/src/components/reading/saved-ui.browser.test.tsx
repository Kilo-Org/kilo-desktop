import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	createSavedPainter,
	paintedSavedRanges,
} from "@kilo-desktop/ui/lib/reading/saved-highlights";

import { SavedToast } from "./saved-toast";
import { SelectionMenu } from "./selection-menu";

afterEach(cleanup);

const anchor = new DOMRect(200, 300, 120, 20);

describe("SelectionMenu", () => {
	it("offers Save and Copy above the selection, and Remove over saved text", async () => {
		const onSave = vi.fn();
		const onCopy = vi.fn();
		const view = render(
			<SelectionMenu
				anchor={anchor}
				mode="save"
				onSave={onSave}
				onRemove={() => {}}
				onCopy={onCopy}
				onDismiss={() => {}}
			/>,
		);
		const menu = page.getByRole("toolbar", { name: "Selection" });
		await expect.element(menu).toBeVisible();
		await expect
			.poll(() => menu.element().getBoundingClientRect().bottom)
			.toBeLessThanOrEqual(anchor.top);
		expect(Math.round(menu.element().getBoundingClientRect().height)).toBe(34);

		await page.getByRole("button", { name: "Save" }).click();
		await page.getByRole("button", { name: "Copy" }).click();
		expect(onSave).toHaveBeenCalledOnce();
		expect(onCopy).toHaveBeenCalledOnce();

		const onRemove = vi.fn();
		view.rerender(
			<SelectionMenu
				anchor={anchor}
				mode="remove"
				onSave={() => {}}
				onRemove={onRemove}
				onCopy={() => {}}
				onDismiss={() => {}}
			/>,
		);
		await page.getByRole("button", { name: "Remove" }).click();
		expect(onRemove).toHaveBeenCalledOnce();
	});

	it("goes below a selection at the top of the window, and dismisses on Escape or a press elsewhere", async () => {
		const onDismiss = vi.fn();
		render(
			<>
				<button type="button">elsewhere</button>
				<SelectionMenu
					anchor={new DOMRect(200, 2, 100, 18)}
					mode="save"
					onSave={() => {}}
					onRemove={() => {}}
					onCopy={() => {}}
					onDismiss={onDismiss}
				/>
			</>,
		);
		const menu = page.getByRole("toolbar", { name: "Selection" });
		await expect.poll(() => menu.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(20);

		await userEvent.keyboard("{Escape}");
		await page.getByRole("button", { name: "elsewhere" }).click();
		expect(onDismiss).toHaveBeenCalledTimes(2);
	});
});

describe("SavedToast", () => {
	it("shows the message with View and Undo, closing after either", async () => {
		const onView = vi.fn();
		const onUndo = vi.fn();
		const onClose = vi.fn();
		render(
			<SavedToast message="Added to Saved" onView={onView} onUndo={onUndo} onClose={onClose} />,
		);

		await expect.element(page.getByRole("status").getByText("Added to Saved")).toBeVisible();
		await page.getByRole("button", { name: "View" }).click();
		await page.getByRole("button", { name: "Undo" }).click();

		expect(onView).toHaveBeenCalledOnce();
		expect(onUndo).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("closes by itself, waiting while the pointer is on it", async () => {
		const onClose = vi.fn();
		render(<SavedToast message="Removed from Saved" onClose={onClose} durationMs={150} />);
		const toast = page.getByRole("status");

		await toast.hover();
		await expect.element(toast).toBeVisible();
		vi.useFakeTimers();
		vi.advanceTimersByTime(300);
		vi.useRealTimers();
		expect(onClose).not.toHaveBeenCalled();
		await page.elementLocator(document.body).hover({ position: { x: 1, y: 1 } });

		await expect.poll(() => onClose.mock.calls.length).toBe(1);
	});
});

describe("saved highlights", () => {
	it("paints every painter's ranges under one highlight, and clears a painter's on dispose", () => {
		const text = document.createElement("p");
		text.textContent = "one two three";
		document.body.append(text);
		const range = (start: number, end: number) => {
			const value = document.createRange();
			value.setStart(text.firstChild!, start);
			value.setEnd(text.firstChild!, end);
			return value;
		};
		const first = createSavedPainter();
		const second = createSavedPainter();

		first.paint([range(0, 3)]);
		second.paint([range(4, 7)]);
		expect(paintedSavedRanges().map(String)).toEqual(["one", "two"]);
		expect(CSS.highlights.get("kilo-saved")?.size).toBe(2);

		first.dispose();
		second.paint([]);
		expect(paintedSavedRanges()).toEqual([]);
		expect(CSS.highlights.has("kilo-saved")).toBe(false);
		text.remove();
	});
});
