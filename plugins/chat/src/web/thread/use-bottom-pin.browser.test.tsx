import { cleanup, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBottomPin } from "./use-bottom-pin";

afterEach(cleanup);

let addLines: (count: number) => void = () => {};

function Box({ active }: { active: boolean }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [lines, setLines] = useState(5);
	addLines = (count) => setLines((current) => current + count);
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

describe("useBottomPin", () => {
	it("follows new content, and keeps following once the reader scrolls back down", async () => {
		const { getByTestId } = render(<Box active />);
		const box = getByTestId("box");
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
		const { getByTestId } = render(<Box active={false} />);
		addLines(5);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(getByTestId("box").scrollTop).toBe(0);
	});
});
