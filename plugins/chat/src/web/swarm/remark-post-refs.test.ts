import { describe, expect, it } from "vitest";

import { postRefsExtension } from "./remark-post-refs";

type Node = { type: string; value?: string; children?: Node[]; data?: { hProperties?: object } };

const run = (text: string, known: number[]) => {
	const tree: Node = {
		type: "root",
		children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
	};
	const plugin = postRefsExtension(new Set(known))!.remarkPlugins![0] as () => (tree: Node) => void;
	plugin()(tree);
	return tree.children![0]!.children!;
};

describe("postRefsExtension", () => {
	it("chips known post numbers only", () => {
		const nodes = run("Per #2 and #9, see issue#3", [2, 3]);
		expect(nodes.map((node) => node.type)).toEqual(["text", "postRef", "text"]);
		expect(nodes[1]!.children![0]!.value).toBe("#2");
		expect(nodes[1]!.data!.hProperties).toMatchObject({ dataPostRef: "2" });
	});

	it("is nothing without loaded posts", () => {
		expect(postRefsExtension(new Set())).toBeNull();
	});
});
