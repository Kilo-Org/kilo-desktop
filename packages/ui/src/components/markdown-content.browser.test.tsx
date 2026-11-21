import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { MarkdownRendererExtension } from "../lib/markdown-extension.js";
import { markdownIslandHtml } from "../lib/markdown-islands.js";
import { MarkdownContent } from "./markdown-content.js";

afterEach(cleanup);

describe("MarkdownContent", () => {
	it("renders GitHub Flavored Markdown and drops raw HTML", async () => {
		render(
			<MarkdownContent
				text={"# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n<b>raw</b> ~~gone~~"}
			/>,
		);

		await expect.element(page.getByRole("heading", { name: "Title" })).toBeVisible();
		expect(document.querySelectorAll("td")).toHaveLength(2);
		expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
		expect(document.querySelector("b")).toBeNull();
		expect(document.querySelector("del")?.textContent).toBe("gone");
	});

	it("renders TeX math as SVG and leaves prices as text", async () => {
		render(<MarkdownContent text={"Euler: $e^{i\\pi}+1=0$ costs $5.\n\n$$\n\\frac{a}{b}\n$$\n"} />);

		await expect.element(page.getByRole("img", { name: "e^{i\\pi}+1=0" })).toBeVisible();
		expect(document.querySelector('svg[data-markdown="math-display"]')).not.toBeNull();
		expect(document.querySelector("p")?.textContent).toContain("costs $5.");
	});

	it("renders mermaid fences as diagrams and leaves other code alone", async () => {
		render(
			<MarkdownContent
				text={"```mermaid\nflowchart LR\n  A --> B\n```\n\n```js\nconst a = 1;\n```\n\nUse `x`."}
			/>,
		);

		await expect
			.poll(() => document.querySelector('[data-markdown="mermaid"] svg'), { timeout: 10_000 })
			.not.toBeNull();
		expect(document.querySelectorAll("pre")).toHaveLength(1);
		expect(document.querySelector('[data-mermaid-action="expand"]')).toBeNull();
		expect(document.querySelector("pre code.language-js")?.textContent).toBe("const a = 1;\n");
		expect(document.querySelector("p code")?.textContent).toBe("x");
	});

	it("opens a drawn diagram through onExpandMermaid, from Expand or the diagram", async () => {
		const onExpandMermaid = vi.fn();
		render(
			<MarkdownContent
				onCopyCode={vi.fn()}
				onExpandMermaid={onExpandMermaid}
				text={"```mermaid\nflowchart LR\n  A --> B\n```\n"}
			/>,
		);

		const expand = page.getByRole("button", { name: "Open diagram in viewer" });
		await expect.element(expand).toBeVisible();
		// Shown in the code header, just before Copy.
		const expandBox = expand.element().getBoundingClientRect();
		const copyBox = page
			.getByRole("button", { name: "Copy code" })
			.element()
			.getBoundingClientRect();
		expect(expandBox.top).toBeCloseTo(copyBox.top, 0);
		expect(expandBox.right).toBeLessThanOrEqual(copyBox.left);
		expect(copyBox.left - expandBox.right).toBeLessThan(8);
		await expand.click();
		expect(onExpandMermaid).toHaveBeenLastCalledWith({
			code: "flowchart LR\n  A --> B\n",
			element: document.querySelector('[data-markdown="mermaid"]'),
		});
		document
			.querySelector<SVGElement>('[data-markdown="mermaid"] svg')
			?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onExpandMermaid).toHaveBeenCalledTimes(2);
	});

	it("keeps a mermaid fence that does not parse as code", async () => {
		render(<MarkdownContent text={"```mermaid\nnotADiagram\n  nonsense\n```\n"} />);

		await expect
			.poll(() => document.querySelector("pre code")?.textContent, { timeout: 10_000 })
			.toContain("nonsense");
		expect(document.querySelector('[data-markdown="mermaid"]')).toBeNull();
	});

	it("applies extension hooks, renderers, islands and clicks", async () => {
		const clicked = vi.fn();
		const extension: MarkdownRendererExtension = {
			components: {
				a: (html) => html.replace("<a ", '<a data-extended="" '),
			},
			renderers: [
				{
					language: "note",
					render: ({ code }) => markdownIslandHtml("div", "note", { text: code.trim() }),
				},
			],
			islands: {
				note: { render: (data) => <strong data-qa-id="note">{String(data.text)}</strong> },
			},
			onClick: (event) => {
				const anchor = (event.target as Element).closest("a");
				if (!anchor) return;
				event.preventDefault();
				clicked(anchor.getAttribute("href"));
			},
		};
		render(
			<MarkdownContent
				extensions={[extension]}
				text={"[Docs](https://example.com/?a=1&b=2)\n\n```note\nHello\n```\n"}
			/>,
		);

		await expect.element(page.getByTestId("note")).toHaveTextContent("Hello");
		await page.getByRole("link", { name: "Docs" }).click();
		expect(document.querySelector("a[data-extended]")).not.toBeNull();
		expect(clicked).toHaveBeenCalledWith("https://example.com/?a=1&b=2");
	});

	it("keeps relative links from navigating the window", async () => {
		render(<MarkdownContent text={"[Elsewhere](docs/other.md)"} />);
		const onWindowClick = vi.fn((event: MouseEvent) => event.defaultPrevented);
		window.addEventListener("click", onWindowClick);
		try {
			await page.getByRole("link", { name: "Elsewhere" }).click();
			expect(onWindowClick).toHaveReturnedWith(true);
		} finally {
			window.removeEventListener("click", onWindowClick);
		}
	});

	it("copies code blocks through onCopyCode", async () => {
		const onCopyCode = vi.fn();
		render(<MarkdownContent onCopyCode={onCopyCode} text={"```sh\npnpm test\n```\n"} />);

		await page.getByRole("button", { name: "Copy code" }).click();

		expect(onCopyCode).toHaveBeenCalledWith("pnpm test\n");
		await expect
			.element(page.getByRole("button", { name: "Copy code" }))
			.toHaveAttribute("data-copied", "true");
	});
});
