import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/react";

const FILE_MENTION = /@(?:\/([^\s"@]+)|"\/((?:[^"\\]|\\.)+)")/gu;

export const kiloFileMentionFormatter: Unstable_DirectiveFormatter = {
	serialize(item) {
		const path = item.id.startsWith("/") ? item.id : `/${item.id}`;
		return /[\s"]/u.test(path) ? `@"${path.replaceAll('"', '\\"')}"` : `@${path}`;
	},
	parse(text) {
		if (!text) return [];
		const segments: Unstable_DirectiveSegment[] = [];
		let cursor = 0;
		for (const match of text.matchAll(FILE_MENTION)) {
			const index = match.index;
			if (index > cursor) segments.push({ kind: "text", text: text.slice(cursor, index) });
			const relativePath = (match[1] ?? match[2]?.replaceAll('\\"', '"'))!;
			segments.push({
				kind: "mention",
				type: "file",
				id: relativePath,
				label: relativePath.split("/").at(-1) ?? relativePath,
			});
			cursor = index + match[0].length;
		}
		if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
		return segments.length ? segments : [{ kind: "text", text }];
	},
};

export function resolveFileMention(
	id: string,
	workspaceFolders: readonly { readonly path: string; readonly isPrimary: boolean }[],
): { workspaceDirectory: string; relativePath: string } | null {
	const normalizedId = id.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
	for (const folder of workspaceFolders) {
		const workspaceDirectory = folder.path.replaceAll("\\", "/").replace(/\/+$/gu, "");
		const comparableRoot = workspaceDirectory.replace(/^\/+|\/+$/gu, "");
		if (normalizedId.startsWith(`${comparableRoot}/`)) {
			return {
				workspaceDirectory: folder.path,
				relativePath: normalizedId.slice(comparableRoot.length + 1),
			};
		}
	}
	const primary = workspaceFolders.find((folder) => folder.isPrimary) ?? workspaceFolders[0];
	return primary && normalizedId
		? { workspaceDirectory: primary.path, relativePath: normalizedId }
		: null;
}

export function withFileMentions(
	formatter: Unstable_DirectiveFormatter,
): Unstable_DirectiveFormatter {
	return {
		serialize: (item) =>
			item.type === "file" ? kiloFileMentionFormatter.serialize(item) : formatter.serialize(item),
		parse(text) {
			return formatter
				.parse(text)
				.flatMap((segment) =>
					segment.kind === "text" ? kiloFileMentionFormatter.parse(segment.text) : [segment],
				);
		},
	};
}
