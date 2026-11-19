import type { MarkdownRendererExtension } from "@kilo-desktop/ui/lib/markdown-extension";

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Code is shown as written; links and images keep their text whole. */
const SKIP = new Set(["code", "inlineCode", "html", "link", "linkReference", "image"]);

const HIGHLIGHT_CLASS = "rounded-sm bg-amber-300/50 text-foreground dark:bg-amber-400/35";

function split(value: string, query: string): MdNode[] | null {
	const lower = value.toLowerCase();
	let index = lower.indexOf(query);
	if (index < 0) return null;
	const nodes: MdNode[] = [];
	let at = 0;
	while (index >= 0) {
		if (index > at) nodes.push({ type: "text", value: value.slice(at, index) });
		nodes.push({
			type: "searchHighlight",
			data: { hName: "mark", hProperties: { className: HIGHLIGHT_CLASS } },
			children: [{ type: "text", value: value.slice(index, index + query.length) }],
		});
		at = index + query.length;
		index = lower.indexOf(query, at);
	}
	if (at < value.length) nodes.push({ type: "text", value: value.slice(at) });
	return nodes;
}

function walk(node: MdNode, query: string): void {
	if (!node.children || SKIP.has(node.type)) return;
	node.children = node.children.flatMap((child) => {
		if (child.type === "text" && child.value) return split(child.value, query) ?? [child];
		walk(child, query);
		return [child];
	});
}

/** Marks every match of `query` (any case) in a post's prose, as a markdown extension. */
export function highlightExtension(query: string): MarkdownRendererExtension | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return null;
	return { remarkPlugins: [() => (tree: MdNode) => walk(tree, needle)] };
}
