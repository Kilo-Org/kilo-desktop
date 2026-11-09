export interface SessionFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface ResolvedSessionPath {
	/** The matching folder, exactly as the session lists it. */
	readonly workspaceDirectory: string;
	/** `/`-separated path inside that folder; empty when the path is the folder itself. */
	readonly relativePath: string;
}

/**
 * The folders a session shows: its workspace's, with the session's own
 * directory (its worktree) standing in for the primary folder. A session
 * without a workspace shows just its directory.
 */
export function sessionFolders(
	workspaceFolders: readonly SessionFolder[],
	directory: string | null,
): SessionFolder[] {
	if (workspaceFolders.length === 0) return directory ? [{ path: directory, isPrimary: true }] : [];
	return workspaceFolders.map(({ path, isPrimary }) =>
		isPrimary && directory ? { path: directory, isPrimary: true } : { path, isPrimary },
	);
}

function toSlashes(path: string): string {
	return path.replaceAll("\\", "/");
}

function isWindowsPath(slashPath: string): boolean {
	return /^[A-Za-z]:\//u.test(slashPath);
}

function isAbsolute(slashPath: string): boolean {
	return slashPath.startsWith("/") || isWindowsPath(slashPath);
}

/**
 * Collapses `.`, `..` and repeated separators, and upper-cases a Windows
 * drive letter; null when `..` climbs above the root.
 */
function normalizeAbsolute(slashPath: string): string | null {
	const root = slashPath.startsWith("/") ? "/" : slashPath.slice(0, 3).toUpperCase();
	const segments: string[] = [];
	for (const segment of slashPath.slice(root.length).split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return root + segments.join("/");
}

/**
 * Whether the host's filesystem usually ignores letter case: Windows and
 * macOS do, Linux does not. Works in main and in the renderer, which has no
 * `process`.
 */
function hostIgnoresCase(): boolean {
	const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
	if (platform !== undefined) return platform !== "linux";
	return typeof navigator === "undefined" || !navigator.platform.startsWith("Linux");
}

function segmentsOf(normalized: string): string[] {
	const segments = normalized.split("/");
	return segments.at(-1) === "" ? segments.slice(0, -1) : segments;
}

/** `target` relative to `folderPath` (both normalized), or null when outside it. */
function relativeTo(folderPath: string, target: string, ignoreCase: boolean): string | null {
	const fold = (segment: string) => (ignoreCase ? segment.toLowerCase() : segment);
	const folderSegments = segmentsOf(folderPath);
	const targetSegments = segmentsOf(target);
	if (targetSegments.length < folderSegments.length) return null;
	const inside = folderSegments.every(
		(segment, index) => fold(segment) === fold(targetSegments[index]!),
	);
	return inside ? targetSegments.slice(folderSegments.length).join("/") : null;
}

export interface ResolvePathOptions {
	/**
	 * Compare letter case-insensitively. Defaults to true for Windows paths
	 * and, otherwise, to whether the host's filesystem ignores case.
	 */
	readonly ignoreCase?: boolean;
}

/**
 * Maps an absolute path, or one relative to the primary folder, onto the
 * deepest session folder holding it; null when it is outside every folder.
 */
export function resolvePathInFolders(
	folders: readonly SessionFolder[],
	path: string,
	options: ResolvePathOptions = {},
): ResolvedSessionPath | null {
	const input = toSlashes(path.trim());
	if (!input) return null;
	const primary = folders.find((folder) => folder.isPrimary) ?? folders[0];
	const candidate = isAbsolute(input) ? input : primary && `${toSlashes(primary.path)}/${input}`;
	const target = candidate ? normalizeAbsolute(candidate) : null;
	if (target === null) return null;
	const ignoreCase = options.ignoreCase ?? (isWindowsPath(target) || hostIgnoresCase());

	let best: { resolved: ResolvedSessionPath; depth: number } | undefined;
	for (const folder of folders) {
		const folderPath = normalizeAbsolute(toSlashes(folder.path));
		if (folderPath === null) continue;
		const relativePath = relativeTo(folderPath, target, ignoreCase);
		if (relativePath === null || (best && best.depth >= folderPath.length)) continue;
		best = {
			resolved: { workspaceDirectory: folder.path, relativePath },
			depth: folderPath.length,
		};
	}
	return best?.resolved ?? null;
}
