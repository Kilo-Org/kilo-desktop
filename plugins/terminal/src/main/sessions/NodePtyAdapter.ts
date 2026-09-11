import { createRequire } from "node:module";
import type { spawn as spawnNodePty } from "node-pty";

import type { PtyAdapter, PtyProcess, PtySpawnOptions } from "./pty.js";

const nodeRequire = createRequire(import.meta.url);

export class NodePtyAdapter implements PtyAdapter {
	spawn(options: PtySpawnOptions): PtyProcess {
		// Kept inside this method so merely registering the plugin does not load the
		// native binding until the first authorized terminal is opened.
		const pty = requireNodePty();
		const process = pty.spawn(options.shell, [...options.args], {
			cwd: options.cwd,
			cols: options.cols,
			rows: options.rows,
			env: options.env,
			name: processPlatform() === "win32" ? "xterm-color" : "xterm-256color",
		});
		return {
			pid: process.pid,
			write: (data) => process.write(data),
			resize: (cols, rows) => process.resize(cols, rows),
			kill: (signal) => process.kill(signal),
			onData: (listener) => {
				const disposable = process.onData(listener);
				return () => disposable.dispose();
			},
			onExit: (listener) => {
				const disposable = process.onExit(({ exitCode, signal }) =>
					listener({ exitCode, signal: signal ?? null }),
				);
				return () => disposable.dispose();
			},
		};
	}
}

function processPlatform(): NodeJS.Platform {
	return process.platform;
}

function requireNodePty(): { spawn: typeof spawnNodePty } {
	return nodeRequire("node-pty") as { spawn: typeof spawnNodePty };
}
