import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBottomPin } from "./use-bottom-pin";

afterEach(cleanup);

function Box({ active, lines }: { active: boolean; lines: number }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	useBottomPin(scrollRef, contentRef, active);
	return (
		<div ref={scrollRef} data-testid="box" style={{ height: 100, overflowY: "auto" }}>
			<div ref={contentRef}>
				{Array.from({ length: lines }, (_, index) => (
					<p key={index} style={{ height: 40, margin: 0 }}>
						line {index}
					</p>
				))}
			</div>
		</div>
	);
}

const atBottom = (box: HTMLElement) =>
	Math.abs(box.scrollHeight - box.scrollTop - box.clientHeight) <= 1;

/** Renders a box of five lines; the returned function adds lines to it. */
function renderBox(active: boolean) {
	let lines = 5;
	const view = render(<Box active={active} lines={lines} />);
	const addLines = (count: number) => {
		lines += count;
		view.rerender(<Box active={active} lines={lines} />);
	};
	return { box: view.getByTestId("box"), addLines };
}

/** Lets layout and its ResizeObserver callbacks run. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe("useBottomPin", () => {
	it("follows new content, and keeps following once the reader scrolls back down", async () => {
		const { box, addLines } = renderBox(true);
		await vi.waitFor(() => expect(atBottom(box)).toBe(true));

		addLines(5);
		await vi.waitFor(() => expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight));

		box.scrollTop = 0;
		box.dispatchEvent(new Event("scroll"));
		box.scrollTop = box.scrollHeight;
		box.dispatchEvent(new Event("scroll"));
		addLines(5);
		await vi.waitFor(() => expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight));
	});

	it("leaves the box alone while inactive", async () => {
		const { box, addLines } = renderBox(false);
		addLines(5);
		await vi.waitFor(() => expect(box.querySelectorAll("p")).toHaveLength(10));
		await nextFrame();
		expect(box.scrollTop).toBe(0);
	});
});
