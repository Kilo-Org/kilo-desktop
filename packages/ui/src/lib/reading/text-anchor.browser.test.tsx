import { afterEach, describe, expect, it } from "vitest";

import { findQuote, locateQuote, quoteOf } from "./text-anchor";

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

function select(root: HTMLElement, text: string): Range {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const at = (node as Text).data.indexOf(text);
		if (at >= 0) {
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + text.length);
			return range;
		}
	}
	throw new Error(`No ${text}`);
}

describe("text anchors", () => {
	it("remembers a selection by its quote and finds it again after re-rendering", () => {
		const root = mount("<p>Fix the <strong>login</strong> redirect.</p><p>Then test it.</p>");
		const range = document.createRange();
		range.setStart(root.querySelector("strong")!.firstChild!, 0);
		range.setEnd(root.querySelectorAll("p")[0]!.lastChild!, 9);

		const quote = quoteOf(root, range)!;
		expect(quote).toMatchObject({ exact: "login redirect", prefix: "Fix the ", startHint: 8 });

		root.innerHTML =
			"<h2>Intro</h2><p>Fix the <strong>login</strong> redirect.</p><p>Then test it.</p>";
		const again = locateQuote(root, quote)!;
		expect(again.toString()).toBe("login redirect");
	});

	it("tells repeated text apart by its surroundings", () => {
		const text = "first: the fix. second: the fix. third: the fix.";
		const quote = { exact: "the fix", prefix: "second: ", suffix: ". third", startHint: 0 };

		expect(findQuote(text, quote)).toEqual({ start: 24, end: 31 });
		expect(findQuote(text, { ...quote, prefix: "", suffix: "", startHint: 40 })).toEqual({
			start: 40,
			end: 47,
		});
		expect(findQuote(text, { ...quote, exact: "gone" })).toBeNull();
	});

	it("refuses an empty or outside selection", () => {
		const root = mount("<p>Hello world</p>");
		const outside = mount("<p>elsewhere</p>");

		expect(quoteOf(root, select(outside, "elsewhere"))).toBeNull();
		const blank = document.createRange();
		blank.setStart(root.querySelector("p")!.firstChild!, 2);
		blank.collapse(true);
		expect(quoteOf(root, blank)).toBeNull();
		expect(quoteOf(root, select(root, "world"))?.exact).toBe("world");
	});

	it("reads element positions, and spans several roots", () => {
		const first = mount("<p>Alpha <em>beta</em></p>");
		const second = mount("<p>gamma delta</p>");
		const range = document.createRange();
		range.setStart(first.querySelector("p")!, 1);
		range.setEnd(second.querySelector("p")!.firstChild!, 5);

		const quote = quoteOf([first, second], range)!;
		expect(quote.exact).toBe("betagamma");
		expect(locateQuote([first, second], quote)?.toString()).toBe("betagamma");

		const end = document.createRange();
		end.setStart(first.querySelector("em")!.firstChild!, 0);
		end.setEnd(first.querySelector("p")!, 2);
		expect(quoteOf(first, end)?.exact).toBe("beta");
		expect(
			locateQuote(first, { exact: "missing", prefix: "", suffix: "", startHint: 0 }),
		).toBeNull();
	});
});
