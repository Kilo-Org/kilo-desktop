const HOME = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/;
const KEEP_TAIL = 2;

/**
 * A path short enough to read at a glance: the home folder becomes `~`, and
 * a deep path keeps its first folder and last two (`/var/…/fixtures/api`),
 * the part that tells similar folders apart.
 */
export function compactPath(path: string): string {
	const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
	const homed = path.replace(HOME, "~");
	const segments = homed.split(separator);
	// segments[0] is "" for an absolute POSIX path, "~" or a drive otherwise.
	const head = segments[0] === "" ? 2 : 1;
	if (segments.length <= head + KEEP_TAIL + 1) return homed;
	return [...segments.slice(0, head), "…", ...segments.slice(-KEEP_TAIL)].join(separator);
}
