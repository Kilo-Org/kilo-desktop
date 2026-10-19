import { afterEach, describe, expect, it } from "vitest";

import { findRanges } from "@kilo-desktop/ui/lib/dom-find";

const roots: HTMLElement[] = [];

function makeRoot(html: string): HTMLElement {
	const element = document.createElement("div");
	element.innerHTML = html;
	document.body.append(element);
	roots.push(element);
	return element;
}

afterEach(() => {
	for (const root of roots.splice(0)) root.remove();
});

describe("findRanges", () => {
	it("returns no ranges for empty or whitespace-only queries", () => {
		const root = makeRoot("<p>hello world</p>");
		expect(findRanges(root, "")).toHaveLength(0);
		expect(findRanges(root, "   ")).toHaveLength(0);
	});

	it("matches case-insensitively by default across multiple nodes", () => {
		const root = makeRoot("<p>Hello world</p><p>another hello here</p>");
		const ranges = findRanges(root, "hello");
		expect(ranges).toHaveLength(2);
		expect(ranges.map((range) => range.toString())).toEqual(["Hello", "hello"]);
	});

	it("finds multiple matches within a single text node", () => {
		const root = makeRoot("<p>na na na</p>");
		expect(findRanges(root, "na")).toHaveLength(3);
	});

	it("respects case sensitivity when requested", () => {
		const root = makeRoot("<p>hello Hello</p>");
		expect(findRanges(root, "Hello")).toHaveLength(2);
		expect(findRanges(root, "Hello", { caseSensitive: true })).toHaveLength(1);
	});

	it("matches phrases that span inline formatting within a block", () => {
		const root = makeRoot("<p>run <code>pnpm dev</code> to <strong>start</strong> it</p>");
		expect(findRanges(root, "run pnpm").map(String)).toEqual(["run pnpm"]);
		expect(findRanges(root, "to start it").map(String)).toEqual(["to start it"]);
	});

	it("matches phrases that span syntax-highlighted code tokens", () => {
		const root = makeRoot(
			'<pre><code><span class="line"><span>const</span><span> foo</span><span> =</span>' +
				'<span> bar</span></span>\n<span class="line"><span>next</span></span></code></pre>',
		);
		expect(findRanges(root, "foo = bar").map(String)).toEqual(["foo = bar"]);
	});

	it("folds case for characters outside the Basic Multilingual Plane", () => {
		// Deseret capital and small long I (each a surrogate pair).
		const root = makeRoot("<p>\u{10400} and \u{10428}</p>");
		expect(findRanges(root, "\u{10400}").map(String)).toEqual(["\u{10400}", "\u{10428}"]);
		expect(findRanges(root, "\u{10400}", { caseSensitive: true }).map(String)).toEqual([
			"\u{10400}",
		]);
	});

	it("treats a run of rendered whitespace as a single space", () => {
		const root = makeRoot("<p>   soft\n   wrapped line</p>");
		expect(findRanges(root, "soft wrapped").map(String)).toEqual(["soft\n   wrapped"]);
		expect(findRanges(root, "wrapped line").map(String)).toEqual(["wrapped line"]);
		expect(findRanges(root, "soft").map(String)).toEqual(["soft"]);
	});

	it("treats Unicode whitespace in the query and the text the same", () => {
		expect(findRanges(makeRoot("<p>a\u00a0b</p>"), "a b")).toHaveLength(1);
		expect(findRanges(makeRoot("<p>a b</p>"), "a\u3000b")).toHaveLength(1);
		expect(findRanges(makeRoot("<p>a\u2003\u00a0b</p>"), "a\u202fb")).toHaveLength(1);
		expect(findRanges(makeRoot("<p>a\u00a0b</p>"), "\u00a0\u3000")).toHaveLength(0);
	});

	it("does not join text across block boundaries", () => {
		const root = makeRoot("<p>foo</p><p>bar</p>");
		expect(findRanges(root, "foobar")).toHaveLength(0);
	});

	it("skips text hidden by CSS, such as collapsed sections", () => {
		const root = makeRoot(
			"<p>target</p>" +
				"<p style='display: none'>target</p>" +
				"<div style='visibility: hidden'><span>target</span></div>",
		);
		expect(findRanges(root, "target")).toHaveLength(1);
	});

	it("skips screen-reader-only labels such as icon-button tooltips and task status", () => {
		const root = makeRoot(
			"<p>copy this</p>" +
				"<button><svg></svg><span class='sr-only'>Copy</span></button>" +
				"<ul><li><span class='sr-only'>completed</span>Write docs</li></ul>",
		);
		expect(findRanges(root, "copy").map(String)).toEqual(["copy"]);
		expect(findRanges(root, "completed")).toHaveLength(0);
	});

	it("keeps text in transparent (fading-in) content searchable", () => {
		// Assistant messages animate in from opacity 0; excluding transparent text
		// would drop a fresh reply, since animations never trigger a recompute.
		const root = makeRoot("<div style='opacity: 0'><p>fresh reply</p></div>");
		expect(findRanges(root, "fresh reply")).toHaveLength(1);
	});

	it("skips hidden, aria-hidden, script, and style content", () => {
		const root = makeRoot(
			"<p>target</p>" +
				"<p hidden>target</p>" +
				"<p aria-hidden='true'>target</p>" +
				"<script>target</script>" +
				"<style>target</style>",
		);
		expect(findRanges(root, "target")).toHaveLength(1);
	});

	it("returns matches in document order across blocks, past whitespace-only ones", () => {
		const root = makeRoot("<p>one</p><p>   </p><p>two one</p>");
		const ranges = findRanges(root, "one");
		expect(ranges.map((range) => range.startContainer.parentElement?.textContent)).toEqual([
			"one",
			"two one",
		]);
	});
});
