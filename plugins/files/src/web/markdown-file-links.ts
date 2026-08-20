export interface MarkdownFileWorkspaceFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface MarkdownFileLinkTarget {
	readonly workspaceDirectory: string;
	readonly relativePath: string;
	readonly line?: number;
	readonly column?: number;
}

const SOURCE_POSITION_HASH = /^#L(\d+)(?:C(\d+))?$/iu;
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:\//iu;

function isLikelyFilePath(value: string): boolean {
	const slashed = value.replaceAll("\\", "/");
	if (slashed.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(slashed)) return true;
	if (slashed.startsWith("./") || slashed.startsWith("../")) return true;
	if (slashed.includes("/")) return true;
	return /\.[a-z\d_-]+(?::\d+(?::\d+)?)?$/iu.test(slashed);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function normalizePath(value: string): string {
	const slashed = value.replaceAll("\\", "/");
	const drive = slashed.match(/^[a-z]:/iu)?.[0];
	const absolute = slashed.startsWith("/") || drive !== undefined;
	const segments: string[] = [];
	for (const segment of slashed.slice(drive?.length ?? 0).split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	const prefix = drive ? `${drive}/` : absolute ? "/" : "";
	return `${prefix}${segments.join("/")}`;
}

function comparablePath(value: string): string {
	return WINDOWS_ABSOLUTE_PATH.test(value) ? value.toLowerCase() : value;
}

function workspaceTarget(
	absolutePath: string,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
): Pick<MarkdownFileLinkTarget, "workspaceDirectory" | "relativePath"> | null {
	const normalizedPath = normalizePath(absolutePath);
	const comparableTarget = comparablePath(normalizedPath);
	const owningFolder = [...workspaceFolders]
		.sort((left, right) => right.path.length - left.path.length)
		.find((folder) => {
			const root = comparablePath(normalizePath(folder.path)).replace(/\/$/u, "");
			return comparableTarget.startsWith(`${root}/`);
		});
	if (!owningFolder) return null;
	const workspaceDirectory = normalizePath(owningFolder.path).replace(/\/$/u, "");
	return {
		workspaceDirectory,
		relativePath: normalizedPath.slice(workspaceDirectory.length + 1),
	};
}

export function resolveMarkdownFileLink(
	href: string | undefined,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
): MarkdownFileLinkTarget | null {
	if (!href) return null;
	const primary = workspaceFolders.find((folder) => folder.isPrimary) ?? workspaceFolders[0];
	if (!primary) return null;

	const hashIndex = href.indexOf("#");
	const rawPath = hashIndex < 0 ? href : href.slice(0, hashIndex);
	const position = hashIndex < 0 ? null : href.slice(hashIndex).match(SOURCE_POSITION_HASH);
	let line = position?.[1] ? Number.parseInt(position[1], 10) : undefined;
	let column = position?.[2] ? Number.parseInt(position[2], 10) : undefined;
	let decodedPath: string;
	if (rawPath.toLowerCase().startsWith("file:")) {
		try {
			decodedPath = safeDecode(new URL(rawPath).pathname).replace(/^\/([a-z]:[\\/])/iu, "$1");
		} catch {
			return null;
		}
	} else {
		if (URI_SCHEME.test(rawPath)) return null;
		decodedPath = safeDecode(rawPath.split("?", 1)[0] ?? "");
	}
	if (!decodedPath || !isLikelyFilePath(decodedPath)) return null;
	if (line === undefined) {
		const suffix = decodedPath.match(/^(.*?):(\d+)(?::(\d+))?$/u);
		if (suffix?.[1] && suffix[2]) {
			decodedPath = suffix[1];
			line = Number.parseInt(suffix[2], 10);
			column = suffix[3] ? Number.parseInt(suffix[3], 10) : undefined;
		}
	}

	const absolutePath =
		decodedPath.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(decodedPath.replaceAll("\\", "/"))
			? decodedPath
			: `${primary.path}/${decodedPath}`;
	const target = workspaceTarget(absolutePath, workspaceFolders);
	if (!target) return null;

	return {
		...target,
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {}),
	};
}
