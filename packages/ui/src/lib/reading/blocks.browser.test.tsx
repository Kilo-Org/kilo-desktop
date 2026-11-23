import { afterEach, describe, expect, it } from "vitest";

import { blockIndexAt, blockIndexOf, readingBlocks } from "./blocks";

const roots: HTMLElement[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) root.remove();
});

function mount(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.append(root);
	roots.push(root);
	return root;
}

const text = (blocks: ReturnType<typeof readingBlocks>) =>
	blocks.map((block) => block.elements.map((element) => element.textContent).join("|"));

describe("reading blocks", () => {
	it("splits Markdown into paragraphs, headings, list items and code blocks", () => {
		const root = mount(`
			<div class="aui-md">
				<h2>Plan</h2>
				<p>First step.</p>
				<ul><li>One <ul><li>nested</li></ul></li><li>Two</li></ul>
				<hr />
				<div class="aui-code-header-root">ts</div>
				<pre>const a = 1;</pre>
				<blockquote>Quote</blockquote>
				<p>   </p>
			</div>`);

		expect(text(readingBlocks(root))).toEqual([
			"Plan",
			"First step.",
			"One nested",
			"Two",
			"ts|const a = 1;",
			"Quote",
		]);
	});

	it("reads several Markdown parts in order, and a Markdown root directly", () => {
		const root = mount(`
			<div class="aui-md"><p>A</p></div>
			<div>tool output</div>
			<div class="aui-md"><p>B</p></div>`);

		expect(text(readingBlocks(root))).toEqual(["A", "B"]);
		expect(text(readingBlocks(root.querySelector(".aui-md")!))).toEqual(["A"]);
	});

	it("finds the block holding a node, and the block at a height", () => {
		const root = mount(`
			<div class="aui-md" style="font-size:16px;line-height:20px">
				<p style="margin:0 0 40px">A</p>
				<p style="margin:0">B</p>
			</div>`);
		const blocks = readingBlocks(root);
		const b = root.querySelectorAll("p")[1]!;
		const top = root.getBoundingClientRect().top;

		expect(blockIndexOf(blocks, b.firstChild)).toBe(1);
		expect(blockIndexOf(blocks, document.body)).toBe(-1);
		expect(blockIndexAt(blocks, top + 5)).toBe(0);
		expect(blockIndexAt(blocks, top + 25)).toBe(0);
		expect(blockIndexAt(blocks, top + 50)).toBe(1);
		expect(blockIndexAt(blocks, top + 900)).toBe(1);
		expect(blockIndexAt([], 0)).toBe(-1);
	});

	it("finds the block at a height among many, as a scan of every block would", () => {
		const root = mount(`
			<div class="aui-md" style="font-size:16px;line-height:20px">
				${Array.from({ length: 41 }, (_, index) => `<p style="margin:0 0 ${index % 7}px">P${index}</p>`).join("")}
			</div>`);
		const blocks = readingBlocks(root);
		const boxes = [...root.querySelectorAll("p")].map((p) => p.getBoundingClientRect());
		const nearest = (y: number) => {
			let best = -1;
			let bestDistance = Number.POSITIVE_INFINITY;
			boxes.forEach((box, index) => {
				const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
				if (distance < bestDistance) [best, bestDistance] = [index, distance];
			});
			return best;
		};
		const top = boxes[0]!.top - 30;
		const bottom = boxes.at(-1)!.bottom + 30;

		for (let y = top; y <= bottom; y += 1.5) expect(blockIndexAt(blocks, y)).toBe(nearest(y));
	});
});
