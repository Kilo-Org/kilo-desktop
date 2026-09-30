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
const URI_SCHEME = /^([a-z][a-z\d+.-]*):(.*)$/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:\//iu;
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-z]:[\\/]/iu;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/u;
const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/u;
const RELATIVE_FILE_PATH_PATTERN = /^[a-z\d._-]+(?:\/[a-z\d._-]+)+(?::\d+){0,2}$/iu;
const RELATIVE_FILE_NAME_PATTERN = /^[a-z\d._-]+\.[a-z\d_-]+(?::\d+){0,2}$/iu;
const INLINE_CODE_DISQUALIFIER_PATTERN = /[\s`]/u;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;
const FILE_EXTENSION_PATTERN = /\.[a-z\d_-]+$/iu;
const NUMERIC_DOTTED_PATTERN = /^\d+(?:\.\d+)+$/u;
const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/u;
const POSITION_ONLY_PATTERN = /^\d+(?::\d+)?$/u;
const BARE_EXTENSIONLESS_POSITION_PATTERN = /^[a-z\d_-]+(?::\d+){1,2}$/iu;
const EXTENSIONLESS_FILE_NAMES = new Set([
	"Makefile",
	"makefile",
	"GNUmakefile",
	"Dockerfile",
	"Containerfile",
	"Justfile",
	"justfile",
	"Rakefile",
	"Gemfile",
	"Procfile",
	"Brewfile",
	"Caddyfile",
	"Vagrantfile",
	"Jenkinsfile",
	"Podfile",
	"Fastfile",
	"BUILD",
	"WORKSPACE",
	"LICENSE",
	"LICENCE",
	"COPYING",
	"NOTICE",
	"AUTHORS",
	"CONTRIBUTORS",
	"CHANGELOG",
	"README",
	"CODEOWNERS",
]);
const SINGLE_LABEL_HOSTNAMES = new Set(["localhost"]);
const GENERIC_HOSTNAME_TLDS = new Set([
	"com",
	"net",
	"org",
	"io",
	"dev",
	"app",
	"ai",
	"co",
	"edu",
	"gov",
	"mil",
	"info",
	"biz",
	"xyz",
	"me",
	"tv",
	"cc",
	"gg",
	"chat",
	"cloud",
	"site",
	"online",
	"tech",
	"store",
	"link",
]);
const COUNTRY_HOSTNAME_TLDS = new Set([
	"uk",
	"de",
	"fr",
	"nl",
	"se",
	"no",
	"fi",
	"dk",
	"pl",
	"ch",
	"at",
	"be",
	"es",
	"it",
	"pt",
	"eu",
	"us",
	"ca",
	"au",
	"nz",
	"jp",
	"kr",
	"cn",
	"br",
	"ru",
	"mx",
	"ie",
	"cz",
	"tr",
	"sg",
	"hk",
]);
const POSIX_FILE_ROOT_PREFIXES = [
	"/Users/",
	"/home/",
	"/tmp/",
	"/var/",
	"/etc/",
	"/opt/",
	"/mnt/",
	"/Volumes/",
	"/private/",
	"/root/",
	"/usr/",
	"/bin/",
	"/sbin/",
	"/lib/",
	"/lib64/",
	"/srv/",
	"/dev/",
	"/proc/",
	"/sys/",
	"/run/",
	"/boot/",
	"/media/",
	"/workspace/",
	"/workspaces/",
] as const;

function looksLikePosixFilesystemPath(path: string): boolean {
	if (!path.startsWith("/")) return false;
	if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
	if (POSITION_SUFFIX_PATTERN.test(path)) return true;
	const fileName = path.slice(path.lastIndexOf("/") + 1);
	return FILE_EXTENSION_PATTERN.test(fileName);
}

function isLikelyFilePath(value: string): boolean {
	if (WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value)) return true;
	if (RELATIVE_PATH_PREFIX_PATTERN.test(value)) return true;
	if (value.startsWith("/")) return looksLikePosixFilesystemPath(value);
	return RELATIVE_FILE_PATH_PATTERN.test(value) || RELATIVE_FILE_NAME_PATTERN.test(value);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function normalizeMarkdownLinkDestination(value: string): string {
	const trimmed = value.trim();
	return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

function normalizeWindowsDrivePath(path: string): string {
	return /^\/[a-z]:[\\/]/iu.test(path) ? path.slice(1) : path;
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

function basename(path: string): string {
	const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
	if (segment.startsWith(".")) return false;
	const lowered = segment.toLowerCase();
	if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true;
	if (NUMERIC_DOTTED_PATTERN.test(segment)) return true;
	const labels = lowered.split(".");
	const lastLabel = labels.at(-1);
	if (labels.length < 2 || lastLabel === undefined) return false;
	if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true;
	return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel);
}

function hasExternalScheme(path: string): boolean {
	const match = path.match(URI_SCHEME);
	if (!match) return false;
	const rest = match[2] ?? "";
	if (rest.startsWith("//")) return true;
	return !POSITION_ONLY_PATTERN.test(rest);
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
	const normalizedRoot = normalizePath(owningFolder.path).replace(/\/$/u, "");
	// The file viewer identifies workspaces by their registered path verbatim, so the
	// normalized (forward-slash) form is only used for matching, never returned.
	return {
		workspaceDirectory: owningFolder.path,
		relativePath: normalizedPath.slice(normalizedRoot.length + 1),
	};
}

export function resolveMarkdownFileLink(
	href: string | undefined,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
	relativeTo?: string,
): MarkdownFileLinkTarget | null {
	if (!href) return null;
	const primary = workspaceFolders.find((folder) => folder.isPrimary) ?? workspaceFolders[0];
	if (!primary) return null;

	const normalizedHref = normalizeMarkdownLinkDestination(href);
	const hashIndex = normalizedHref.indexOf("#");
	const rawPath = hashIndex < 0 ? normalizedHref : normalizedHref.slice(0, hashIndex);
	const position =
		hashIndex < 0 ? null : normalizedHref.slice(hashIndex).match(SOURCE_POSITION_HASH);
	let line = position?.[1] ? Number.parseInt(position[1], 10) : undefined;
	let column = position?.[2] ? Number.parseInt(position[2], 10) : undefined;
	let decodedPath: string;
	if (rawPath.toLowerCase().startsWith("file:")) {
		try {
			decodedPath = normalizeWindowsDrivePath(safeDecode(new URL(rawPath).pathname));
		} catch {
			return null;
		}
	} else {
		if (
			!WINDOWS_DRIVE_PATH_PATTERN.test(rawPath) &&
			!WINDOWS_UNC_PATH_PATTERN.test(rawPath) &&
			hasExternalScheme(rawPath)
		) {
			return null;
		}
		decodedPath = normalizeWindowsDrivePath(safeDecode(rawPath.split("?", 1)[0] ?? ""));
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

	const relativeDirectory = relativeTo
		? normalizePath(relativeTo).split("/").slice(0, -1).join("/")
		: "";
	const absolutePath =
		decodedPath.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(decodedPath.replaceAll("\\", "/"))
			? decodedPath
			: `${primary.path}/${relativeDirectory ? `${relativeDirectory}/` : ""}${decodedPath}`;
	const target = workspaceTarget(absolutePath, workspaceFolders);
	if (!target) return null;

	return {
		...target,
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {}),
	};
}

export function resolveInlineCodeFileLink(
	codeText: string,
	workspaceFolders: readonly MarkdownFileWorkspaceFolder[],
	relativeTo?: string,
	knownRelativePaths?: ReadonlySet<string>,
): MarkdownFileLinkTarget | null {
	const trimmed = codeText.trim();
	if (!trimmed || INLINE_CODE_DISQUALIFIER_PATTERN.test(trimmed)) return null;

	const candidate =
		WINDOWS_DRIVE_PATH_PATTERN.test(trimmed) || WINDOWS_UNC_PATH_PATTERN.test(trimmed)
			? trimmed
			: trimmed.replaceAll("\\", "/");
	const hasPosition = POSITION_SUFFIX_PATTERN.test(candidate);
	if (!hasPosition && !PATH_SEPARATOR_PATTERN.test(candidate)) {
		const target = resolveMarkdownFileLink(candidate, workspaceFolders, relativeTo);
		return target && knownRelativePaths?.has(target.relativePath) ? target : null;
	}

	const hasExplicitPathShape =
		candidate.startsWith("~/") ||
		candidate.startsWith("./") ||
		candidate.startsWith("../") ||
		candidate.startsWith("/") ||
		WINDOWS_DRIVE_PATH_PATTERN.test(candidate) ||
		WINDOWS_UNC_PATH_PATTERN.test(candidate);
	if (!hasExplicitPathShape) {
		const withoutPosition = candidate.replace(POSITION_SUFFIX_PATTERN, "");
		const firstSegment = withoutPosition.split("/")[0] ?? withoutPosition;
		if (looksLikeHostname(firstSegment, hasPosition)) return null;
		if (!hasPosition && !FILE_EXTENSION_PATTERN.test(basename(withoutPosition))) return null;
	}

	const resolved = resolveMarkdownFileLink(candidate, workspaceFolders, relativeTo);
	if (resolved) return resolved;
	if (
		BARE_EXTENSIONLESS_POSITION_PATTERN.test(candidate) &&
		EXTENSIONLESS_FILE_NAMES.has(candidate.replace(POSITION_SUFFIX_PATTERN, ""))
	) {
		return resolveMarkdownFileLink(`./${candidate}`, workspaceFolders, relativeTo);
	}
	return null;
}
