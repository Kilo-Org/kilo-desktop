import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readdir, readFile, stat } from "node:fs/promises";

import type { DetectExecFile, DetectFs } from "./detect-profiles";

/** Detection's file system on Node: every check fails soft to false. */
export function createNodeDetectFs(platform: NodeJS.Platform): DetectFs {
	return {
		async isExecutableFile(path) {
			try {
				if (!(await stat(path)).isFile()) return false;
			} catch {
				// Store-installed apps (app execution aliases) can refuse stat but still launch.
				if (platform !== "win32") return false;
				try {
					return !(await lstat(path)).isDirectory();
				} catch {
					return false;
				}
			}
			if (platform === "win32") return true;
			try {
				await access(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
		async isDirectory(path) {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		readdir: (path) => readdir(path),
		readFile: (path) => readFile(path, "utf8"),
	};
}

/** Runs a program directly (never through a shell), returning its raw output. */
export const nodeExecFile: DetectExecFile = (file, args, options) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			[...args],
			{ encoding: "buffer", timeout: options.timeout, env: options.env, windowsHide: true },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
