import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

/**
 * Where the `runtimed` daemon listens.
 *
 * Mirrors `default_socket_path()` / `socket_path_for_channel()` in nteract's
 * `crates/runt-workspace/src/lib.rs`. Four details are easy to get wrong:
 *
 * - Production has no `worktrees` segment; dev mode (`RUNTIMED_DEV=1` or
 *   `RUNTIMED_WORKSPACE_PATH`) inserts `worktrees/<sha256(path)[..12]>` so
 *   parallel checkouts get isolated daemons.
 * - Windows uses a named pipe, not a filesystem path. `node:net` connects to
 *   both through the same `createConnection(path)` call.
 * - The pipe name comes from the daemon *binary* basename
 *   (`runtimed` / `runtimed-nightly`), which is a different axis from the cache
 *   namespace used on Unix (`runt` / `runt-nightly`).
 * - A source build defaults to the nightly channel, not stable: upstream keys
 *   this off the compile-time `RUNT_BUILD_CHANNEL`, where anything other than
 *   `stable` means nightly.
 */
export interface SocketPathEnvironment {
	readonly RUNTIMED_SOCKET_PATH?: string | undefined;
	readonly RUNTIMED_DEV?: string | undefined;
	readonly RUNTIMED_WORKSPACE_PATH?: string | undefined;
	readonly RUNT_BUILD_CHANNEL?: string | undefined;
	readonly XDG_CACHE_HOME?: string | undefined;
	readonly LOCALAPPDATA?: string | undefined;
}

export interface ResolveSocketPathOptions {
	readonly env?: SocketPathEnvironment;
	readonly platform?: NodeJS.Platform;
	readonly homedir?: string;
}

export type BuildChannel = "stable" | "nightly";

/** Only an explicit `stable` selects the stable channel; everything else is nightly. */
export function buildChannel(env: SocketPathEnvironment): BuildChannel {
	return env.RUNT_BUILD_CHANNEL?.toLowerCase() === "stable" ? "stable" : "nightly";
}

export function cacheNamespace(channel: BuildChannel): string {
	return channel === "stable" ? "runt" : "runt-nightly";
}

export function daemonBinaryBasename(channel: BuildChannel): string {
	return channel === "stable" ? "runtimed" : "runtimed-nightly";
}

export function isDevMode(env: SocketPathEnvironment): boolean {
	return env.RUNTIMED_DEV === "1" || Boolean(env.RUNTIMED_WORKSPACE_PATH);
}

export function worktreeHash(workspacePath: string): string {
	return createHash("sha256").update(workspacePath).digest("hex").slice(0, 12);
}

function cacheDir(env: SocketPathEnvironment, platform: NodeJS.Platform, homedir: string): string {
	if (env.XDG_CACHE_HOME) return env.XDG_CACHE_HOME;
	if (platform === "darwin") return path.join(homedir, "Library", "Caches");
	if (platform === "win32") {
		return env.LOCALAPPDATA ?? path.join(homedir, "AppData", "Local");
	}
	return path.join(homedir, ".cache");
}

export function resolveDaemonSocketPath(options: ResolveSocketPathOptions = {}): string {
	const env = options.env ?? (process.env as SocketPathEnvironment);
	const platform = options.platform ?? process.platform;
	const homedir = options.homedir ?? os.homedir();

	// Upstream panics if this points somewhere whose parent is missing; we take
	// it verbatim and let the connect attempt produce the error instead.
	const override = env.RUNTIMED_SOCKET_PATH?.trim();
	if (override) return override;

	const channel = buildChannel(env);
	const workspacePath = env.RUNTIMED_WORKSPACE_PATH;
	const devMode = isDevMode(env);

	if (platform === "win32") {
		const suffix = devMode && workspacePath ? `-${worktreeHash(workspacePath)}` : "";
		return `\\\\.\\pipe\\${daemonBinaryBasename(channel)}${suffix}`;
	}

	// Deliberately not overridable by `RUNTIMED_CACHE_NAMESPACE`: the daemon's Rust
	// never reads that variable, so honoring it here would compute a socket path
	// nothing is listening on. Relocating a daemon needs the `--socket` flag.
	const base = path.join(cacheDir(env, platform, homedir), cacheNamespace(channel));
	if (devMode && workspacePath) {
		return path.join(base, "worktrees", worktreeHash(workspacePath), "runtimed.sock");
	}
	return path.join(base, "runtimed.sock");
}
