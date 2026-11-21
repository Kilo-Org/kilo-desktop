import { escapeHtml } from "@pierre/words/html";

/**
 * The host markup `@pierre/words` portals a React island into.
 *
 * Words mounts islands only from `island-NAME` fences and `:name[]`
 * directives, but it finds their hosts by scanning its rendered output for
 * `data-words-island`. A code-block renderer or element hook that returns this
 * markup therefore mounts the `islands` entry `name` from ordinary markdown
 * (an image, a fenced block). The host key starts with `[`, which Words
 * numbers by occurrence, so each block keeps its component and state while
 * its data changes during a stream. Mirrors `islandHost` in Words 0.3.0;
 * revisit when upgrading Words.
 */
export function markdownIslandHtml(
	tag: "div" | "span",
	name: string,
	data: Readonly<Record<string, unknown>>,
): string {
	const payload = JSON.stringify({ ...data, id: name });
	return (
		`<${tag} data-words-island="${escapeHtml(name)}"` +
		` data-words-island-id="${escapeHtml(JSON.stringify([name]))}"` +
		` data-words-island-data="${escapeHtml(payload)}">` +
		`<${tag} data-words-island-content></${tag}>` +
		`<${tag} data-words-island-fallback></${tag}>` +
		`</${tag}>`
	);
}
