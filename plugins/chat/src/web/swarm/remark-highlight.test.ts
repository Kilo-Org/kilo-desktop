import { describe, expect, it } from "vitest";

import { highlightExtension } from "./remark-highlight";

type Node = { type: string; value?: string; children?: Node[] };

function run(query: string, tree: Node): Node {
	const plugin = highlightExtension(query)!.remarkPlugins![0] as () => (tree: Node) => void;
	plugin()(tree);
	return tree;
}

describe("highlightExtension", () => {
	it("marks every match in prose, any case, and leaves code alone", () => {
		const tree = run("schema", {
			type: "root",
			children: [
				{ type: "paragraph", children: [{ type: "text", value: "Schema A and schema B" }] },
				{ type: "inlineCode", value: "schema" },
			],
		});
		const paragraph = tree.children![0]!.children!;
		expect(paragraph.map((node) => node.type)).toEqual([
			"searchHighlight",
			"text",
			"searchHighlight",
			"text",
		]);
		expect(paragraph[0]!.children![0]!.value).toBe("Schema");
		expect(tree.children![1]).toEqual({ type: "inlineCode", value: "schema" });
	});

	it("is nothing without a query", () => {
		expect(highlightExtension("  ")).toBeNull();
	});
});
