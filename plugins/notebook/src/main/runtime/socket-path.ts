import os from "node:os";
import path from "node:path";

/**
 * Where the `runtimed` daemon listens.
 *
 * Mirrors `default_socket_path()` / `socket_path_for_channel()` in nteract's
 * `crates/runt-workspace/src/lib.rs`. Four details are easy to get wrong:
 *
 * - Windows uses a named pipe, not a filesystem path. `node:net` connects to
 *   both through the same `createConnection(path)` call.
 * - The pipe name comes from the daemon *binary* basename
 *   (`runtimed` / `runtimed-nightly`), which is a different axis from the cache
 *   namespace used on Unix (`runt` / `runt-nightly`).
 * - Kilo Desktop is a guest of the installed channel-level singleton. It
 *   intentionally ignores ambient nteract worktree variables; development can
 *   opt into a worktree daemon with an explicit `RUNTIMED_SOCKET_PATH`.
 */
export interface SocketPathEnvironment {
	readonly RUNTIMED_SOCKET_PATH?: string | undefined;
	/** Ambient nteract worktree variables are accepted but deliberately ignored. */
	readonly RUNTIMED_DEV?: string | undefined;
	readonly RUNTIMED_WORKSPACE_PATH?: string | undefined;
	readonly XDG_CACHE_HOME?: string | undefined;
	readonly LOCALAPPDATA?: string | undefined;
}

export interface ResolveSocketPathOptions {
	readonly env?: SocketPathEnvironment;
	readonly platform?: NodeJS.Platform;
	readonly homedir?: string;
	readonly channel?: BuildChannel;
}

export type BuildChannel = "stable" | "nightly";

export function cacheNamespace(channel: BuildChannel): string {
	return channel === "stable" ? "runt" : "runt-nightly";
}

export function daemonBinaryBasename(channel: BuildChannel): string {
	return channel === "stable" ? "runtimed" : "runtimed-nightly";
}

function cacheDir(env: SocketPathEnvironment, platform: NodeJS.Platform, homedir: string): string {
	const targetPath = platform === "win32" ? path.win32 : path.posix;
	if (platform === "darwin") return targetPath.join(homedir, "Library", "Caches");
	if (platform === "win32") {
		return env.LOCALAPPDATA ?? targetPath.join(homedir, "AppData", "Local");
	}
	if (env.XDG_CACHE_HOME && path.posix.isAbsolute(env.XDG_CACHE_HOME)) return env.XDG_CACHE_HOME;
	return targetPath.join(homedir, ".cache");
}

export function resolveDaemonSocketPath(options: ResolveSocketPathOptions = {}): string {
	const env = options.env ?? (process.env as SocketPathEnvironment);
	const platform = options.platform ?? process.platform;
	const homedir = options.homedir ?? os.homedir();

	// Upstream panics if this points somewhere whose parent is missing; we take
	// it verbatim and let the connect attempt produce the error instead.
	const override = env.RUNTIMED_SOCKET_PATH?.trim();
	if (override) return override;

	const channel = options.channel ?? "stable";

	if (platform === "win32") {
		return `\\\\.\\pipe\\${daemonBinaryBasename(channel)}`;
	}

	// Deliberately not overridable by `RUNTIMED_CACHE_NAMESPACE`: the daemon's Rust
	// never reads that variable, so honoring it here would compute a socket path
	// nothing is listening on. Relocating a daemon needs the `--socket` flag.
	return path.posix.join(
		cacheDir(env, platform, homedir),
		cacheNamespace(channel),
		"runtimed.sock",
	);
}
