import { render } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	createPaneContentMountRegistry,
	PaneContentMount,
	PaneContentTarget,
} from "./PaneContentMount";

describe("PaneContentMount", () => {
	it("reattaches a remounted host to a target that stayed mounted", async () => {
		function Harness() {
			const parkingRef = useRef<HTMLDivElement>(null);
			const [registry] = useState(() => createPaneContentMountRegistry(parkingRef));
			const [showContent, setShowContent] = useState(true);

			return (
				<>
					<div ref={parkingRef} hidden />
					<button type="button" onClick={() => setShowContent((shown) => !shown)}>
						Toggle content
					</button>
					<PaneContentTarget paneId="terminal" registry={registry} />
					{showContent ? (
						<PaneContentMount paneId="terminal" registry={registry}>
							<div data-pane-content>Terminal content</div>
						</PaneContentMount>
					) : null}
				</>
			);
		}

		const { baseElement } = render(<Harness />);
		const toggle = page.elementLocator(baseElement).getByRole("button", {
			name: "Toggle content",
		});

		await vi.waitFor(() => expect(baseElement.querySelector("[data-pane-content]")).not.toBeNull());
		await toggle.click();
		await vi.waitFor(() => expect(baseElement.querySelector("[data-pane-content]")).toBeNull());
		await toggle.click();
		await vi.waitFor(() => expect(baseElement.querySelector("[data-pane-content]")).not.toBeNull());
	});
});
