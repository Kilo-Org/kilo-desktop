import { homedir } from "node:os";
import { join } from "node:path";

// Mirrors vscode's files.watcherExclude defaults. No '**/'-prefixed
// patterns: they compile to a pathological RegExp that stalls CPU in large
// workspaces (microsoft/vscode#305923). Build-output trees (dist, coverage,
// ...) and node_modules are deliberately NOT excluded — subscribers filter
// via their own excludes; vscode made the same call so tooling sees
// node_modules changes.
const DEFAULT_WATCH_EXCLUDES = [
	".git/objects/**",
	".git/subtree-cache/**",
	".hg/store/**",
	"*/.git/objects/**",
	"*/.git/subtree-cache/**",
	"*/.hg/store/**",
] as const;

/**
 * Ignore patterns for the current platform. On macOS, also exclude
 * `Library/Containers` — an absolute plain path, not a glob
 * (microsoft/vscode#208105): watching into it can trigger the
 * system-access dialog on macOS 14+.
 */
export function watcherIgnorePatterns(): string[] {
	if (process.platform !== "darwin") return [...DEFAULT_WATCH_EXCLUDES];
	return [...DEFAULT_WATCH_EXCLUDES, join(homedir(), "Library", "Containers")];
}
