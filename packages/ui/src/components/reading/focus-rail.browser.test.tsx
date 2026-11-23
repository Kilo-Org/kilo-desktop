import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import { FocusRail, type FocusRailTarget } from "./focus-rail";

function Transcript({ onFocusFrom }: { onFocusFrom: (target: FocusRailTarget) => void }) {
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	return (
		<TooltipProvider>
			<div ref={setHost} style={{ position: "relative", width: 600, padding: 40 }}>
				<div data-reading-surface="reply">
					<div className="aui-md">
						<p>First paragraph.</p>
						<p>Second paragraph.</p>
						<p>Third paragraph.</p>
					</div>
				</div>
				<p>Not reading text.</p>
				<FocusRail host={host} onFocusFrom={onFocusFrom} shortcut="⌘⇧F" />
			</div>
		</TooltipProvider>
	);
}

const LONG_PARAGRAPH =
	"A long paragraph that wraps over several lines, so the pointer can leave the column " +
	"well below the rail: it keeps going with more words about reading in Focus, the rail " +
	"that offers it, and the column it sits beside, until it fills a few lines of text.";

/** A centred transcript column with room beside it, the rail placed outside the column. */
function CentredTranscript({ onFocusFrom }: { onFocusFrom: (target: FocusRailTarget) => void }) {
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	return (
		<TooltipProvider>
			<div data-qa-id="pane" style={{ width: 800, display: "flex", justifyContent: "center" }}>
				<div ref={setHost} data-qa-id="column" style={{ position: "relative", width: 600 }}>
					<div data-reading-surface="reply">
						<div className="aui-md">
							<p>{LONG_PARAGRAPH}</p>
						</div>
					</div>
					<FocusRail host={host} onFocusFrom={onFocusFrom} placement="outside" />
				</div>
			</div>
		</TooltipProvider>
	);
}

/** Reading text taller than the scrolling box that shows it. */
function ScrollingTranscript() {
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	return (
		<TooltipProvider>
			<div data-qa-id="scroller" style={{ height: 200, overflowY: "auto", width: 600 }}>
				<div ref={setHost} style={{ position: "relative" }}>
					<div data-reading-surface="reply">
						<div className="aui-md">
							{Array.from({ length: 30 }, (_, index) => (
								<p key={index}>Paragraph {index + 1}.</p>
							))}
						</div>
					</div>
					<FocusRail host={host} onFocusFrom={() => {}} />
				</div>
			</div>
		</TooltipProvider>
	);
}

afterEach(cleanup);

describe("FocusRail", () => {
	it("appears at the middle of the text in view, stays put as the pointer moves, and enters Focus there", async () => {
		const targets: FocusRailTarget[] = [];
		render(<Transcript onFocusFrom={(target) => targets.push(target)} />);
		await expect.element(page.getByTestId("focus-rail")).not.toBeInTheDocument();

		await page.getByText("First paragraph.").hover();

		const rail = page.getByTestId("focus-rail");
		await expect.element(rail).toBeVisible();
		const surface = document.querySelector("[data-reading-surface]")!.getBoundingClientRect();
		const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
		const railTop = rail.element().getBoundingClientRect().top;
		expect(Math.abs(middle(rail.element().getBoundingClientRect()) - middle(surface))).toBeLessThan(
			2,
		);

		await page.getByText("Third paragraph.").hover();
		expect(rail.element().getBoundingClientRect().top).toBe(railTop);

		await page.getByRole("button", { name: "Focus from here" }).click();

		expect(targets).toHaveLength(1);
		expect(targets[0]!.index).toBe(1);
		expect(targets[0]!.surface.dataset.readingSurface).toBe("reply");
	});

	it("keeps its place in the view while the text scrolls under it", async () => {
		render(<ScrollingTranscript />);
		await page.getByText("Paragraph 3.").hover();
		const rail = page.getByTestId("focus-rail");
		await expect.element(rail).toBeVisible();
		const scroller = page.getByTestId("scroller").element();
		const viewMiddle = () => {
			const box = scroller.getBoundingClientRect();
			return (box.top + box.bottom) / 2;
		};
		const railMiddle = () => {
			const box = rail.element().getBoundingClientRect();
			return (box.top + box.bottom) / 2;
		};
		expect(Math.abs(railMiddle() - viewMiddle())).toBeLessThan(2);

		scroller.scrollTop = 300;

		await expect.poll(() => Math.abs(railMiddle() - viewMiddle())).toBeLessThan(2);
	});

	it("stays while the pointer crosses past the column's edge to a rail placed outside", async () => {
		const targets: FocusRailTarget[] = [];
		render(<CentredTranscript onFocusFrom={(target) => targets.push(target)} />);
		const paragraph = page.getByText(LONG_PARAGRAPH);
		const text = paragraph.element().getBoundingClientRect();
		const lowerLine = text.height - 6;
		expect(lowerLine).toBeGreaterThan(30);

		await userEvent.hover(paragraph, { position: { x: text.width - 4, y: lowerLine } });
		await expect.element(page.getByTestId("focus-rail")).toBeVisible();
		const pane = page.getByTestId("pane").element().getBoundingClientRect();
		const column = page.getByTestId("column").element().getBoundingClientRect();
		const rail = page.getByTestId("focus-rail").element().getBoundingClientRect();
		await userEvent.hover(page.getByTestId("pane"), {
			position: { x: column.right - pane.left + 2, y: (rail.top + rail.bottom) / 2 - pane.top },
		});
		await expect.element(page.getByTestId("focus-rail")).toBeVisible();

		await page.getByRole("button", { name: "Focus from here" }).click();

		expect(targets.map(({ index }) => index)).toEqual([0]);
	});

	// In the app the tooltip slides in from the right, over the button under the pointer: if it
	// took the pointer, the host would see the pointer leave and drop the rail.
	it("stays while the pointer rests on the button, its tooltip never taking the pointer", async () => {
		const targets: FocusRailTarget[] = [];
		render(<CentredTranscript onFocusFrom={(target) => targets.push(target)} />);
		const paragraph = page.getByText(LONG_PARAGRAPH);
		await userEvent.hover(paragraph, { position: { x: 20, y: 6 } });
		const button = page.getByRole("button", { name: "Focus from here" });
		await expect.element(button).toBeVisible();

		await userEvent.hover(button);
		const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
		await expect.poll(tooltip).not.toBeNull();

		expect(getComputedStyle(tooltip()!).pointerEvents).toBe("none");
		await expect.element(page.getByTestId("focus-rail")).toBeVisible();
		await button.click();
		expect(targets.map(({ index }) => index)).toEqual([0]);
	});

	it("stays away from text outside reading surfaces", async () => {
		render(<Transcript onFocusFrom={() => {}} />);

		await page.getByText("Not reading text.").hover();

		await expect.element(page.getByTestId("focus-rail")).not.toBeInTheDocument();
	});
});
