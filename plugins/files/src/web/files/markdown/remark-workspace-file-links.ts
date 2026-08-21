import {
	resolveInlineCodeFileLink,
	resolveMarkdownFileLink,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";

export interface MarkdownAstNode {
	type: string;
	value?: string;
	url?: string;
	data?: {
		hProperties?: Record<string, unknown>;
	};
	children?: MarkdownAstNode[];
}

interface RemarkWorkspaceFileLinksOptions {
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
	readonly relativeTo?: string;
	readonly linkifyPlainText?: boolean;
}

const PROTECTED_NODE_TYPES = new Set(["code", "inlineCode", "link", "linkReference", "html"]);
const TOKEN_PATTERN = /\S+/gu;
const LEADING_PUNCTUATION = /^[([{<'"`]+/u;
const TRAILING_PUNCTUATION = /[\])}>,'"`;!?.]+$/u;

function candidateBounds(token: string): { start: number; end: number } {
	const leading = token.match(LEADING_PUNCTUATION)?.[0].length ?? 0;
	let end = token.length - (token.match(TRAILING_PUNCTUATION)?.[0].length ?? 0);
	if (token.slice(leading, end).endsWith(":")) end -= 1;
	return { start: leading, end: Math.max(leading, end) };
}

function linkifyText(
	value: string,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
	relativeTo: string | undefined,
): MarkdownAstNode[] | null {
	const nodes: MarkdownAstNode[] = [];
	let cursor = 0;
	let linked = false;

	for (const match of value.matchAll(TOKEN_PATTERN)) {
		const token = match[0];
		const tokenStart = match.index;
		const { start, end } = candidateBounds(token);
		const candidate = token.slice(start, end);
		if (!candidate || !resolveMarkdownFileLink(candidate, workspaceFolders, relativeTo)) continue;

		const candidateStart = tokenStart + start;
		const candidateEnd = tokenStart + end;
		if (candidateStart > cursor) {
			nodes.push({ type: "text", value: value.slice(cursor, candidateStart) });
		}
		nodes.push({
			type: "link",
			url: candidate,
			data: { hProperties: { "data-workspace-file-candidate": "" } },
			children: [{ type: "text", value: candidate }],
		});
		cursor = candidateEnd;
		linked = true;
	}

	if (!linked) return null;
	if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
	return nodes;
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function parentSegments(path: string): string[] {
	const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
	return segments.slice(0, -1);
}

function parentSuffixesByPath(paths: readonly string[]): Map<string, string> {
	const groups = new Map<string, Set<string>>();
	for (const path of paths) {
		const group = groups.get(basename(path)) ?? new Set<string>();
		group.add(path);
		groups.set(basename(path), group);
	}

	const suffixes = new Map<string, string>();
	for (const group of groups.values()) {
		const uniquePaths = [...group];
		if (uniquePaths.length < 2) continue;
		for (const path of uniquePaths) {
			const segments = parentSegments(path);
			if (segments.length === 0) continue;
			let uniqueDepth = segments.length;
			for (let depth = 1; depth <= segments.length; depth += 1) {
				const candidate = segments.slice(-depth).join("/");
				const collision = uniquePaths.some(
					(otherPath) =>
						otherPath !== path && parentSegments(otherPath).slice(-depth).join("/") === candidate,
				);
				if (!collision) {
					uniqueDepth = depth;
					break;
				}
			}
			const suffixDepth = Math.min(segments.length, Math.max(uniqueDepth, 2));
			suffixes.set(path, segments.slice(-suffixDepth).join("/"));
		}
	}
	return suffixes;
}

function browserSafeFileUrl(url: string): string {
	if (!url.toLowerCase().startsWith("file:")) return url;
	try {
		const parsed = new URL(url);
		return `${parsed.pathname.replace(/^\/([a-z]:[\\/])/iu, "$1")}${parsed.hash}`;
	} catch {
		return url;
	}
}

function annotateFileReferences(
	tree: MarkdownAstNode,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
	relativeTo: string | undefined,
): void {
	const references: Array<{
		node: MarkdownAstNode;
		relativePath: string;
	}> = [];
	const collect = (node: MarkdownAstNode, insideLink: boolean) => {
		if (node.type === "inlineCode" && !insideLink) {
			node.data = {
				...node.data,
				hProperties: {
					...node.data?.hProperties,
					dataInlineCode: "",
				},
			};
			const target = node.value
				? resolveInlineCodeFileLink(node.value, workspaceFolders, relativeTo)
				: null;
			if (target) references.push({ node, relativePath: target.relativePath });
		}
		if (node.type === "link" && node.url) {
			const target = resolveMarkdownFileLink(node.url, workspaceFolders, relativeTo);
			if (target) {
				node.url = browserSafeFileUrl(node.url);
				references.push({ node, relativePath: target.relativePath });
			}
		}
		const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
		node.children?.forEach((child) => collect(child, childInsideLink));
	};
	collect(tree, false);

	const suffixes = parentSuffixesByPath(references.map(({ relativePath }) => relativePath));
	for (const { node, relativePath } of references) {
		const suffix = suffixes.get(relativePath);
		if (!suffix) continue;
		node.data = {
			...node.data,
			hProperties: {
				...node.data?.hProperties,
				"data-file-parent-suffix": suffix,
			},
		};
	}
}

export function remarkWorkspaceFileLinks({
	workspaceFolders,
	relativeTo,
	linkifyPlainText = false,
}: RemarkWorkspaceFileLinksOptions) {
	return (tree: MarkdownAstNode) => {
		const visit = (node: MarkdownAstNode) => {
			if (PROTECTED_NODE_TYPES.has(node.type) || !node.children) return;
			const children: MarkdownAstNode[] = [];
			for (const child of node.children) {
				if (child.type === "text" && child.value !== undefined) {
					children.push(...(linkifyText(child.value, workspaceFolders, relativeTo) ?? [child]));
					continue;
				}
				visit(child);
				children.push(child);
			}
			node.children = children;
		};

		if (linkifyPlainText) visit(tree);
		annotateFileReferences(tree, workspaceFolders, relativeTo);
	};
}
