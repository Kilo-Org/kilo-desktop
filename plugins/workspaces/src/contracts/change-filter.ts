import picomatch from "picomatch";

import type { FileChange, WatchFilter } from "./index";

/** Filter options for file-change subscriptions. */
export type WorkspaceSubscriptionOptions = WatchFilter;
type WorkspaceFileChange = FileChange;

// The literals of `path.win32.sep` / `path.posix.sep`. Contracts are
// isomorphic — this module ships in the renderer bundle, where Node builtins
// are unavailable (standalone-browser mode) — so the separators are named
// constants rather than `node:path` imports. Unconditional by design: vscode's
// glob matcher treats both separators equivalently on every platform too.
const WIN32_SEPARATOR = "\\";
const POSIX_SEPARATOR = "/";

/**
 * Convert a platform-native absolute path to the forward-slash form globs
 * are authored in. Watcher event paths are native (backslash-separated on
 * Windows), but include/exclude globs must be forward-slash based — the
 * filter matches them separator-insensitively (vscode-style), never the
 * reverse. Normalize with this before escaping and embedding a native path
 * in a glob: `escapeGlob(toPosixPath(absolutePath))`.
 */
export function toPosixPath(path: string): string {
	return path.split(WIN32_SEPARATOR).join(POSIX_SEPARATOR);
}

const GLOB_METACHARS = /[\\*?[\]{}()!]/g;

/**
 * Escape a literal string for safe embedding in a glob pattern. Pair with
 * {@link toPosixPath} for native absolute paths:
 * `escapeGlob(toPosixPath(absolutePath))`.
 *
 * Escapes all picomatch magic characters: `\ * ? [ ] { } ( ) !`.
 * The `!` case is intentional — picomatch treats a leading `!` as negation,
 * which lodash `escapeRegExp` missed because `!` is not a RegExp metachar.
 *
 * Kept as a local single-pass replace, not the `glob-escape` package: that
 * package's dead `require("util")` survives CJS bundling into the sandboxed
 * Electron preload, where `util` is not requireable — the preload dies
 * before exposing the desktop bridge and the renderer silently boots in
 * standalone-browser mode.
 */
export function escapeGlob(literal: string): string {
	return literal.replace(GLOB_METACHARS, "\\$&");
}

/**
 * Detect the current platform in a way that works in both Node (main/tests)
 * and the browser renderer (no bare `process` — use `globalThis`). Node path
 * is preferred so process.platform stubs in tests work deterministically.
 */
function currentPlatform(): string | undefined {
	return (globalThis as { process?: { platform?: string } }).process?.platform;
}

/**
 * Compile a subscriber's include/exclude/type filter once (picomatch
 * matchers are built per options change, not per batch). An empty or absent
 * filter list is a pass-through. Shared by main-side watcher subscribers and
 * the renderer `sdk.workspace` surface.
 *
 * Glob matching is case-insensitive on Windows and macOS (mirroring vscode's
 * `ignoreCase: !isLinux` behaviour) and case-sensitive on Linux.
 *
 * Matching is also separator-insensitive the way vscode's glob matcher is:
 * `windows: true` treats `/` and `\` in candidate paths equivalently on
 * every host, so forward-slash globs match native Windows event paths.
 * Passed explicitly because picomatch otherwise auto-detects the host via
 * `process.platform`/`navigator.platform`, which is not reliable in every
 * renderer. Globs themselves must be forward-slash based — build them from
 * native absolute paths via {@link toPosixPath} (a backslash in a glob is an
 * escape, not a separator).
 */
export function createWorkspaceChangeFilter(
	options: WorkspaceSubscriptionOptions,
): (changes: readonly WorkspaceFileChange[]) => WorkspaceFileChange[] {
	const platform = currentPlatform();
	// navigator.platform (renderer, deprecated but frozen in Chromium) is the
	// fallback when process is absent; "Linux" prefix covers all Linux variants.
	const isLinux =
		platform !== undefined
			? platform === "linux"
			: typeof navigator !== "undefined" && navigator.platform.startsWith("Linux");
	const nocase = !isLinux;

	const types = options.types ? new Set(options.types) : null;
	const includes = options.includes?.length
		? picomatch(options.includes, { dot: true, nocase, windows: true })
		: null;
	const excludes = options.excludes?.length
		? picomatch(options.excludes, { dot: true, nocase, windows: true })
		: null;

	return (changes) =>
		changes.filter(
			(change) =>
				(!types || types.has(change.type)) &&
				(!includes || includes(change.path)) &&
				(!excludes || !excludes(change.path)),
		);
}
