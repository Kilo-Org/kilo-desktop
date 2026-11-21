import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { MermaidDiagram } from "./mermaid-diagram.js";

afterEach(cleanup);

describe("MermaidDiagram", () => {
	it("reports its state and hands over the rendered SVG", async () => {
		const onStateChange = vi.fn();
		const onReady = vi.fn();
		render(
			<MermaidDiagram
				code={"flowchart LR\n  Start --> Done"}
				onStateChange={onStateChange}
				onReady={onReady}
			/>,
		);

		await expect
			.poll(() => onStateChange.mock.calls.map(([state]) => state), { timeout: 15_000 })
			.toEqual(["loading", "ready"]);
		expect(onReady).toHaveBeenCalledWith(document.querySelector("svg.pele"));
	});

	it("shows the error and source for a diagram it can't render", async () => {
		const onStateChange = vi.fn();
		render(<MermaidDiagram code={"notADiagram\n  nonsense"} onStateChange={onStateChange} />);

		await expect.element(page.getByText("Could not render this Mermaid diagram")).toBeVisible();
		await expect.element(page.getByText("nonsense", { exact: false })).toBeVisible();
		await expect.poll(() => onStateChange.mock.lastCall?.[0]).toBe("error");
	});
});
