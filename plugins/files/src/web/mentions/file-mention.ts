export type FileMentionItem = {
	readonly id: string;
	readonly type: "file";
	readonly label: string;
	readonly description: string;
	readonly metadata: { readonly icon: "file" };
};

type FileMentionSegment =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "mention";
			readonly type: string;
			readonly id: string;
			readonly label: string;
	  };

export type FileMentionFormatter = {
	serialize(item: { readonly id: string }): string;
	parse(text: string): readonly FileMentionSegment[];
};

const FILE_MENTION = /@(?:\/([^\s"@]+)|"\/((?:[^"\\]|\\.)+)")/gu;

export const fileMentionFormatter: FileMentionFormatter = {
	serialize(item) {
		const path = item.id.startsWith("/") ? item.id : `/${item.id}`;
		return /[\s"]/u.test(path) ? `@"${path.replaceAll('"', '\\"')}" ` : `@${path} `;
	},
	parse(text) {
		if (!text) return [];
		const segments: FileMentionSegment[] = [];
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

export function fileMentionItems(paths: readonly string[]): FileMentionItem[] {
	return paths
		.filter((path) => !path.endsWith("/"))
		.map((path) => ({
			id: path,
			type: "file",
			label: path.split("/").at(-1) ?? path,
			description: path,
			metadata: { icon: "file" },
		}));
}

function folderName(path: string): string {
	return (
		path
			.replace(/[\\/]+$/u, "")
			.split(/[\\/]/u)
			.at(-1) ?? path
	);
}

export function workspaceFileMentionItems(
	results: readonly {
		readonly workspaceDirectory: string;
		readonly paths: readonly string[];
	}[],
): FileMentionItem[] {
	const folderNames = results.map(({ workspaceDirectory }) => folderName(workspaceDirectory));
	const duplicateFolderNames = new Set(
		folderNames.filter((name, index) => folderNames.indexOf(name) !== index),
	);
	return results.flatMap(({ workspaceDirectory, paths }) =>
		fileMentionItems(paths).map((item) => ({
			...item,
			id: `${workspaceDirectory.replace(/[\\/]+$/u, "")}/${item.id}`.replaceAll("\\", "/"),
			description:
				`${duplicateFolderNames.has(folderName(workspaceDirectory)) ? workspaceDirectory : folderName(workspaceDirectory)}/${item.description}`.replaceAll(
					"\\",
					"/",
				),
		})),
	);
}
