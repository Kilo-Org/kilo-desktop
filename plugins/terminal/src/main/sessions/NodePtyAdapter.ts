import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { spawn as spawnNodePty } from "node-pty";

import type { PtyAdapter, PtyProcess, PtySpawnOptions } from "./pty.js";

const nodeRequire = createRequire(import.meta.url);
let didEnsureSpawnHelperExecutable = false;

export class NodePtyAdapter implements PtyAdapter {
	spawn(options: PtySpawnOptions): PtyProcess {
		// Kept inside this method so merely registering the plugin does not load the
		// native binding until the first authorized terminal is opened.
		ensureSpawnHelperExecutable();
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

function ensureSpawnHelperExecutable(): void {
	if (process.platform === "win32" || didEnsureSpawnHelperExecutable) return;
	didEnsureSpawnHelperExecutable = true;
	try {
		const packageDirectory = path.dirname(nodeRequire.resolve("node-pty/package.json"));
		const candidateRoots = [
			packageDirectory,
			packageDirectory.replace("app.asar", "app.asar.unpacked"),
		];
		for (const root of candidateRoots) {
			for (const relativePath of [
				path.join("build", "Release", "spawn-helper"),
				path.join("build", "Debug", "spawn-helper"),
				path.join("prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
			]) {
				const helper = path.join(root, relativePath);
				if (existsSync(helper)) chmodSync(helper, 0o755);
			}
		}
	} catch {
		// node-pty reports the actionable spawn error; permission repair is best effort.
	}
}

function processPlatform(): NodeJS.Platform {
	return process.platform;
}

function requireNodePty(): { spawn: typeof spawnNodePty } {
	return nodeRequire("node-pty") as { spawn: typeof spawnNodePty };
}
