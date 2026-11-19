// Adapted from `getWslProfiles` in VS Code's src/vs/platform/terminal/node/terminalProfiles.ts.
import path from "node:path";

import type { DetectExecFile } from "./detect-profiles";

/** WSL 2 (and the `-d` flag profiles depend on) shipped in Windows 10 build 19041. */
const WSL_MIN_WINDOWS_BUILD = 19_041;
const WSL_LIST_TIMEOUT_MS = 1_000;

export interface WslDistroProfile {
	readonly label: string;
	readonly path: string;
	readonly args: string[];
}

export interface WslSearch {
	readonly system32: string;
	readonly env: NodeJS.ProcessEnv;
	readonly windowsBuild: number | undefined;
	readonly execFile: DetectExecFile;
}

/**
 * A profile per installed WSL distro, or none when WSL is missing, too old or
 * slow to answer. Runs `wsl.exe` directly (no shell). Its output is UTF-16LE
 * unless WSL_UTF8 is set, so that is forced off and decoded explicitly.
 */
export async function listWslProfiles(search: WslSearch): Promise<WslDistroProfile[]> {
	if (search.windowsBuild === undefined || search.windowsBuild < WSL_MIN_WINDOWS_BUILD) return [];
	const wslPath = path.win32.join(search.system32, "wsl.exe");
	let output: Buffer;
	try {
		output = await search.execFile(wslPath, ["-l", "-q"], {
			timeout: WSL_LIST_TIMEOUT_MS,
			env: { ...search.env, WSL_UTF8: "0" },
		});
	} catch {
		return [];
	}
	return output
		.toString("utf16le")
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map((line) => line.replaceAll("\0", "").trim())
		.filter((distro) => distro.length > 0 && !distro.startsWith("docker-desktop"))
		.map((distro) => ({ label: `${distro} (WSL)`, path: wslPath, args: ["-d", distro] }));
}
