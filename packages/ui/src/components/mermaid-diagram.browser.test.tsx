import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, FC } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { MarkdownContent } from "./markdown-content.js";
import { createMermaidMarkdownExtension, MermaidDiagram } from "./mermaid-diagram.js";

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

describe("createMermaidMarkdownExtension", () => {
	it("renders mermaid fences as diagrams and leaves other code alone", async () => {
		render(
			<MarkdownContent
				text={"```mermaid\nflowchart LR\n  A --> B\n```\n\n```js\nconst a = 1;\n```\n\nUse `x`."}
				extensions={[createMermaidMarkdownExtension()]}
			/>,
		);

		await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeInTheDocument();
		expect(document.querySelectorAll("pre")).toHaveLength(1);
		expect(document.querySelector("pre code.language-js")?.textContent).toBe("const a = 1;\n");
		expect(document.querySelector("p code")?.textContent).toBe("x");
	});

	it("falls back to plain elements without base components", () => {
		const components = createMermaidMarkdownExtension().decorateComponents?.({});
		const Pre = components?.pre as FC<ComponentProps<"pre">>;
		const Code = components?.code as FC<ComponentProps<"code">>;
		render(
			<Pre>
				<Code className="language-py">print(1)</Code>
			</Pre>,
		);

		expect(document.querySelector("pre > code.language-py")?.textContent).toBe("print(1)");
	});
});
