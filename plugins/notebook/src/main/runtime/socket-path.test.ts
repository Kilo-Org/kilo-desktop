import { describe, expect, it } from "vitest";

import { resolveDaemonSocketPath } from "./socket-path.js";

const MAC = { platform: "darwin" as const, homedir: "/Users/mm" };
const WIN = { platform: "win32" as const, homedir: "C:\\Users\\mm" };
const LINUX = { platform: "linux" as const, homedir: "/home/mm" };

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

	it("uses the stable channel-level singleton when selected", () => {
		const socketPath = resolveDaemonSocketPath({ env: {}, channel: "stable", ...MAC });
		expect(socketPath).toBe("/Users/mm/Library/Caches/runt/runtimed.sock");
		expect(socketPath).not.toContain("worktrees");
	});

	it("uses the stable channel-level singleton by default", () => {
		expect(resolveDaemonSocketPath({ env: {}, ...MAC })).toContain("/runt/");
	});

	it("ignores RUNTIMED_CACHE_NAMESPACE, which the daemon itself does not read", () => {
		// Honoring it would point us at a socket the daemon never binds.
		const env: Record<string, string> = { RUNTIMED_CACHE_NAMESPACE: "custom-ns" };
		expect(resolveDaemonSocketPath({ env, ...MAC })).toContain("/runt/");
	});

	it("ignores ambient worktree variables and uses the installed singleton", () => {
		const env = { RUNTIMED_DEV: "1", RUNTIMED_WORKSPACE_PATH: "/Users/mm/p/nteract" };
		expect(resolveDaemonSocketPath({ env, ...MAC })).toBe(
			"/Users/mm/Library/Caches/runt/runtimed.sock",
		);
	});

	it("uses XDG_CACHE_HOME when set, on any platform", () => {
		expect(
			resolveDaemonSocketPath({
				env: { XDG_CACHE_HOME: "/xdg" },
				channel: "stable",
				...LINUX,
			}),
		).toBe("/xdg/runt/runtimed.sock");
	});

	it("falls back to ~/.cache on Linux", () => {
		expect(resolveDaemonSocketPath({ env: {}, channel: "stable", ...LINUX })).toBe(
			"/home/mm/.cache/runt/runtimed.sock",
		);
	});

	it("returns a named pipe on Windows, not a filesystem path", () => {
		const socketPath = resolveDaemonSocketPath({ env: {}, channel: "stable", ...WIN });
		expect(socketPath).toBe("\\\\.\\pipe\\runtimed");
		expect(socketPath).not.toContain("Caches");
	});

	it("names the default Windows pipe from the stable daemon binary", () => {
		const socketPath = resolveDaemonSocketPath({ env: {}, ...WIN });
		expect(socketPath).toBe("\\\\.\\pipe\\runtimed");
	});

	it("uses LOCALAPPDATA for the Windows cache dir when a socket path is derived", () => {
		// Windows takes the pipe branch, so LOCALAPPDATA only matters if the
		// platform ever falls through to a file socket; assert the pipe wins.
		expect(resolveDaemonSocketPath({ env: { LOCALAPPDATA: "C:\\cache" }, ...WIN })).toContain(
			"\\\\.\\pipe\\",
		);
	});
});
