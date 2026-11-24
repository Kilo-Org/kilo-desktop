const normalizePath = (path: string): string =>
	path.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "");

/**
 * Plan agents write markdown under these workspace-local directories.
 * Matches `.kilo/plans/*.md`, `.opencode/plans/*.md`, `plans/*.md`, `.plans/*.md`.
 */
const PLAN_PATH_RE = /(^|\/)(?:\.?(?:kilo|opencode)\/plans|\.?plans)\/[^/]+\.md$/i;

export function normalizePlanPath(path: string): string {
	return normalizePath(path);
}

export function isPlanFilePath(path: string): boolean {
	const normalized = normalizePath(path);
	if (!normalized) return false;
	return PLAN_PATH_RE.test(normalized);
}

export function pathsMatch(left: string, right: string): boolean {
	const normalizedLeft = normalizePath(left);
	const normalizedRight = normalizePath(right);
	if (!normalizedLeft || !normalizedRight) return false;
	return (
		normalizedLeft === normalizedRight ||
		normalizedLeft.endsWith(`/${normalizedRight}`) ||
		normalizedRight.endsWith(`/${normalizedLeft}`)
	);
}
