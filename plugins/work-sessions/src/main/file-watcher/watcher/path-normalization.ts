/**
 * Path cleanup applied to every raw watcher event before filtering and
 * emission, ported from VSCode's parcel-watcher integration:
 *
 * 1. NFC normalization — macOS FSEvents reports decomposed (NFD) paths.
 * 2. Symlink remapping — parcel resolves the watched directory through
 *    realpath; subscribers expect paths under the directory as registered,
 *    so event paths are mapped back onto the requested prefix.
 * 3. Windows drive-root normalization — parcel can report roots like `c:\\`
 *    with a duplicated trailing backslash.
 *
 * Pure functions (platform gating lives at the call site) so each rule is
 * testable with known-good literals.
 */

/**
 * Normalize a string to Unicode Normalization Form C (composed). Identity
 * for already-composed and ASCII input. Callers apply this only on macOS,
 * where FSEvents delivers NFD-decomposed paths.
 */
export function normalizeNFC(value: string): string {
	// Fast path: ASCII-only strings cannot contain decomposed sequences.
	if (isAsciiOnly(value)) return value;
	return value.normalize("NFC");
}

function isAsciiOnly(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (value.charCodeAt(index) > 0x7f) return false;
	}
	return true;
}

/**
 * Map an event path reported under `realRoot` (the realpath of the watched
 * directory) back onto `requestedRoot` (the directory as registered), so
 * subscribers see paths under the prefix they asked for. Paths outside
 * `realRoot` pass through unchanged. Identity when the two roots are equal.
 */
export function remapRealPath(path: string, realRoot: string, requestedRoot: string): string {
	if (realRoot === requestedRoot) return path;
	if (path === realRoot) return requestedRoot;
	const separator = realRoot.includes("\\") ? "\\" : "/";
	const prefix = realRoot.endsWith(separator) ? realRoot : realRoot + separator;
	if (path.startsWith(prefix)) {
		const mappedRoot = requestedRoot.endsWith(separator)
			? requestedRoot
			: requestedRoot + separator;
		return mappedRoot + path.slice(prefix.length);
	}
	return path;
}

/**
 * Collapse duplicated trailing backslashes on Windows drive roots (parcel
 * bug workaround for paths like `c:\\`). Ordinary paths are untouched.
 * Callers apply this only on Windows (mirrors `normalizeNFC`'s "only on
 * macOS" contract — platform gating lives at the call site).
 */
export function normalizeWindowsRootPath(path: string): string {
	if (/^[a-zA-Z]:\\+$/.test(path)) {
		const drive = path.slice(0, path.indexOf("\\"));
		return `${drive}\\`;
	}
	return path;
}
