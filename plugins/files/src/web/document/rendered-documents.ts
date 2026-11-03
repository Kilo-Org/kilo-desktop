export function isMarkdownFile(relativePath: string): boolean {
	return /\.(?:md|mdown|markdown)$/iu.test(relativePath);
}

export function isMermaidFile(relativePath: string): boolean {
	return /\.(?:mmd|mermaid)$/iu.test(relativePath);
}

export function hasRenderedPreview(relativePath: string): boolean {
	return isMarkdownFile(relativePath) || isMermaidFile(relativePath);
}

/**
 * Diagram files open rendered, like delimited files open as a table. A tab
 * opened at a source location (line target) starts in the source editor instead.
 */
export function rendersByDefault(relativePath: string, revealLine: number | undefined): boolean {
	return revealLine === undefined && isMermaidFile(relativePath);
}
