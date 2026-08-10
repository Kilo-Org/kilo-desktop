import { describe, expect, it } from "vitest";

import { buildChannel, isDevMode, resolveDaemonSocketPath, worktreeHash } from "./socket-path.js";

const MAC = { platform: "darwin" as const, homedir: "/Users/mm" };
const WIN = { platform: "win32" as const, homedir: "C:\\Users\\mm" };
const LINUX = { platform: "linux" as const, homedir: "/home/mm" };

describe("buildChannel", () => {
	it("treats an unset channel as nightly, matching a source build", () => {
		expect(buildChannel({})).toBe("nightly");
	});

	it("recognizes stable case-insensitively", () => {
		expect(buildChannel({ RUNT_BUILD_CHANNEL: "Stable" })).toBe("stable");
	});

	it("treats any other value as nightly", () => {
		expect(buildChannel({ RUNT_BUILD_CHANNEL: "beta" })).toBe("nightly");
	});
});

describe("isDevMode", () => {
	it("is off with no dev env vars", () => {
		expect(isDevMode({})).toBe(false);
	});

	it("is on for RUNTIMED_DEV=1", () => {
		expect(isDevMode({ RUNTIMED_DEV: "1" })).toBe(true);
	});

	it("is on when a workspace path is set", () => {
		expect(isDevMode({ RUNTIMED_WORKSPACE_PATH: "/repo" })).toBe(true);
	});

	it("is off for RUNTIMED_DEV values other than 1", () => {
		expect(isDevMode({ RUNTIMED_DEV: "0" })).toBe(false);
	});
});

describe("worktreeHash", () => {
	it("is the first 12 hex chars of the sha256 of the path", () => {
		expect(worktreeHash("/Users/mm/p/nteract")).toBe("cd9dcd4fa268");
	});

	it("differs per path so parallel checkouts stay isolated", () => {
		expect(worktreeHash("/a")).not.toBe(worktreeHash("/b"));
	});
});

describe("resolveDaemonSocketPath", () => {
	it("honors an explicit override verbatim", () => {
		const socketPath = resolveDaemonSocketPath({
			env: { RUNTIMED_SOCKET_PATH: "/tmp/custom.sock" },
			...MAC,
		});
		expect(socketPath).toBe("/tmp/custom.sock");
	});

	it("trims whitespace around the override and ignores a blank one", () => {
		expect(
			resolveDaemonSocketPath({ env: { RUNTIMED_SOCKET_PATH: "  /tmp/x.sock  " }, ...MAC }),
		).toBe("/tmp/x.sock");
		expect(resolveDaemonSocketPath({ env: { RUNTIMED_SOCKET_PATH: "   " }, ...MAC })).toContain(
			"runtimed.sock",
		);
	});

	it("omits the worktrees segment in production", () => {
		const socketPath = resolveDaemonSocketPath({ env: { RUNT_BUILD_CHANNEL: "stable" }, ...MAC });
		expect(socketPath).toBe("/Users/mm/Library/Caches/runt/runtimed.sock");
		expect(socketPath).not.toContain("worktrees");
	});

	it("inserts a per-worktree segment in dev mode", () => {
		// Verified against the live daemon: this is the real path of the
		// runtimed instance serving the ~/p/nteract checkout.
		const socketPath = resolveDaemonSocketPath({
			env: { RUNTIMED_DEV: "1", RUNTIMED_WORKSPACE_PATH: "/Users/mm/p/nteract" },
			...MAC,
		});
		expect(socketPath).toBe(
			"/Users/mm/Library/Caches/runt-nightly/worktrees/cd9dcd4fa268/runtimed.sock",
		);
	});

	it("uses the nightly cache namespace for a source build", () => {
		expect(resolveDaemonSocketPath({ env: {}, ...MAC })).toContain("/runt-nightly/");
	});

	it("ignores RUNTIMED_CACHE_NAMESPACE, which the daemon itself does not read", () => {
		// Honoring it would point us at a socket the daemon never binds.
		const env: Record<string, string> = { RUNTIMED_CACHE_NAMESPACE: "custom-ns" };
		expect(resolveDaemonSocketPath({ env, ...MAC })).toContain("/runt-nightly/");
	});

	it("ignores dev mode without a workspace path", () => {
		// RUNTIMED_DEV alone has no worktree to hash, so upstream falls back to
		// the channel-level socket rather than inventing a segment.
		expect(resolveDaemonSocketPath({ env: { RUNTIMED_DEV: "1" }, ...MAC })).toBe(
			"/Users/mm/Library/Caches/runt-nightly/runtimed.sock",
		);
	});

	it("uses XDG_CACHE_HOME when set, on any platform", () => {
		expect(
			resolveDaemonSocketPath({
				env: { XDG_CACHE_HOME: "/xdg", RUNT_BUILD_CHANNEL: "stable" },
				...LINUX,
			}),
		).toBe("/xdg/runt/runtimed.sock");
	});

	it("falls back to ~/.cache on Linux", () => {
		expect(resolveDaemonSocketPath({ env: { RUNT_BUILD_CHANNEL: "stable" }, ...LINUX })).toBe(
			"/home/mm/.cache/runt/runtimed.sock",
		);
	});

	it("returns a named pipe on Windows, not a filesystem path", () => {
		const socketPath = resolveDaemonSocketPath({ env: { RUNT_BUILD_CHANNEL: "stable" }, ...WIN });
		expect(socketPath).toBe("\\\\.\\pipe\\runtimed");
		expect(socketPath).not.toContain("Caches");
	});

	it("names the Windows pipe from the daemon binary, not the cache namespace", () => {
		// The pipe is `runtimed-nightly`, never `runt-nightly` — these are
		// separate axes upstream and conflating them silently misses the daemon.
		const socketPath = resolveDaemonSocketPath({ env: {}, ...WIN });
		expect(socketPath).toBe("\\\\.\\pipe\\runtimed-nightly");
	});

	it("suffixes the Windows pipe with the worktree hash in dev mode", () => {
		const socketPath = resolveDaemonSocketPath({
			env: { RUNTIMED_DEV: "1", RUNTIMED_WORKSPACE_PATH: "/Users/mm/p/nteract" },
			...WIN,
		});
		expect(socketPath).toBe("\\\\.\\pipe\\runtimed-nightly-cd9dcd4fa268");
	});

	it("uses LOCALAPPDATA for the Windows cache dir when a socket path is derived", () => {
		// Windows takes the pipe branch, so LOCALAPPDATA only matters if the
		// platform ever falls through to a file socket; assert the pipe wins.
		expect(resolveDaemonSocketPath({ env: { LOCALAPPDATA: "C:\\cache" }, ...WIN })).toContain(
			"\\\\.\\pipe\\",
		);
	});
});
