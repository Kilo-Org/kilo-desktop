import { useRef, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useStableGutterScrollLock } from "./use-stable-gutter-scroll-lock.js";

const ANIMATION_DURATION = 200;

function ScrollLockHarness() {
	const animatedElementRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const lockScroll = useStableGutterScrollLock(animatedElementRef, ANIMATION_DURATION);

	return (
		<div
			data-testid="scroll-viewport"
			style={{ height: 100, overflowY: "auto", scrollBehavior: "smooth" }}
		>
			<div style={{ height: 400 }}>
				<button
					type="button"
					onClick={() => {
						lockScroll();
						setExpanded((current) => !current);
					}}
				>
					Toggle disclosure
				</button>
				<div
					ref={animatedElementRef}
					style={{
						height: expanded ? 200 : 0,
						transition: `height ${ANIMATION_DURATION}ms linear`,
					}}
				/>
			</div>
		</div>
	);
}

afterEach(cleanup);

describe("useStableGutterScrollLock", () => {
	it("blocks viewport auto-scroll requests only throughout a disclosure animation", async () => {
		const { getByRole, getByTestId } = render(<ScrollLockHarness />);
		const viewport = getByTestId("scroll-viewport");
		viewport.style.scrollBehavior = "auto";
		viewport.scrollTop = 40;
		viewport.style.scrollBehavior = "smooth";
		expect(viewport.scrollTop).toBe(40);

		fireEvent.click(getByRole("button", { name: "Toggle disclosure" }));
		viewport.scrollTo({ top: 160, behavior: "instant" });

		expect(viewport.scrollTop).toBe(40);

		await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION + 50));
		viewport.scrollTo({ top: 160, behavior: "instant" });

		expect(viewport.scrollTop).toBe(160);
	});
});
