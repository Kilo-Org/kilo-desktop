import { createRequire } from "node:module";
import { release } from "node:os";
import type { IPtyForkOptions, IWindowsPtyForkOptions, spawn as spawnNodePty } from "node-pty";

import type { PtyAdapter, PtyProcess, PtySpawnOptions } from "./pty.js";

const nodeRequire = createRequire(import.meta.url);

/** First Windows build where the bundled ConPTY is supported (matches VS Code). */
const BUNDLED_CONPTY_MIN_WINDOWS_BUILD = 18309;

export class NodePtyAdapter implements PtyAdapter {
	spawn(options: PtySpawnOptions): PtyProcess {
		// Kept inside this method so merely registering the plugin does not load the
		// native binding until the first authorized terminal is opened.
		const pty = requireNodePty();
		const platform = process.platform;
		const windowsBuild = platform === "win32" ? parseWindowsBuildNumber(release()) : undefined;
		const ptyProcess = pty.spawn(
			options.shell,
			[...options.args],
			resolveNodePtySpawnOptions(options, platform, windowsBuild),
		);
		return {
			pid: ptyProcess.pid,
			write: (data) => ptyProcess.write(data),
			resize: (cols, rows) => ptyProcess.resize(cols, rows),
			kill: (signal) => ptyProcess.kill(signal),
			onData: (listener) => {
				const disposable = ptyProcess.onData(listener);
				return () => disposable.dispose();
			},
			onExit: (listener) => {
				const disposable = ptyProcess.onExit(({ exitCode, signal }) =>
					listener({ exitCode, signal: signal ?? null }),
				);
				return () => disposable.dispose();
			},
		};
	}
}

/**
 * On Windows, prefer node-pty's bundled conpty.dll: with the OS ConPTY,
 * node-pty's kill() forks a Node helper to enumerate console processes, which
 * Electron forbids because the app disables the RunAsNode fuse. Older or
 * unidentifiable builds keep the OS ConPTY so the terminal still works; there,
 * kill cannot reap console-attached grandchildren.
 */
export function resolveNodePtySpawnOptions(
	options: PtySpawnOptions,
	platform: NodeJS.Platform,
	windowsBuild: number | undefined,
): IPtyForkOptions | IWindowsPtyForkOptions {
	const base = {
		cwd: options.cwd,
		cols: options.cols,
		rows: options.rows,
		env: options.env,
	};
	if (platform !== "win32") return { ...base, name: "xterm-256color" };
	return {
		...base,
		name: "xterm-color",
		useConptyDll: windowsBuild !== undefined && windowsBuild >= BUNDLED_CONPTY_MIN_WINDOWS_BUILD,
	};
}

/** Parses the build from a Windows `os.release()` string such as "10.0.22631". */
export function parseWindowsBuildNumber(osRelease: string): number | undefined {
	const build = osRelease.split(".")[2];
	if (!build || !/^\d+$/.test(build)) return undefined;
	return Number(build);
}

function requireNodePty(): { spawn: typeof spawnNodePty } {
	return nodeRequire("node-pty") as { spawn: typeof spawnNodePty };
}
