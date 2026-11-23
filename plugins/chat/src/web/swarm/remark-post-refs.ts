import type { MarkdownRendererExtension } from "@kilo-desktop/ui/lib/markdown-extension";

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Code is shown as written; links keep their text whole. */
const SKIP = new Set(["code", "inlineCode", "html", "link", "linkReference", "image"]);

const REF = /(^|[^\w&#])#(\d+)\b/g;

export const POST_REF_CLASS =
	"bg-muted text-foreground hover:bg-accent cursor-pointer rounded px-1 font-mono text-[0.85em] tabular-nums";

function split(value: string, known: ReadonlySet<number>): MdNode[] | null {
	const nodes: MdNode[] = [];
	let at = 0;
	for (const match of value.matchAll(REF)) {
		const number = Number(match[2]);
		if (!known.has(number)) continue;
		const start = match.index + match[1]!.length;
		if (start > at) nodes.push({ type: "text", value: value.slice(at, start) });
		nodes.push({
			type: "postRef",
			data: {
				hName: "span",
				hProperties: {
					className: POST_REF_CLASS,
					role: "button",
					tabIndex: 0,
					dataPostRef: String(number),
					ariaLabel: `Show post #${number}`,
				},
			},
			children: [{ type: "text", value: `#${number}` }],
		});
		at = start + 1 + match[2]!.length;
	}
	if (nodes.length === 0) return null;
	if (at < value.length) nodes.push({ type: "text", value: value.slice(at) });
	return nodes;
}

function walk(node: MdNode, known: ReadonlySet<number>): void {
	if (!node.children || SKIP.has(node.type)) return;
	node.children = node.children.flatMap((child) => {
		if (child.type === "text" && child.value) return split(child.value, known) ?? [child];
		walk(child, known);
		return [child];
	});
}

/**
 * Turns `#n` in a post's prose into a chip for post n when the board has it
 * loaded; the board handles clicks on `[data-post-ref]`.
 */
export function postRefsExtension(known: ReadonlySet<number>): MarkdownRendererExtension | null {
	if (known.size === 0) return null;
	return { remarkPlugins: [() => (tree: MdNode) => walk(tree, known)] };
}
