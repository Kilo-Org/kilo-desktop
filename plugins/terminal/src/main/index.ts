import os from "node:os";
import path from "node:path";

import { mainHost } from "@kilo-desktop/kernel";

import { createTerminalMainEntry } from "./entry";
import { loginShellsOf } from "./profiles/detect-profiles";
import { createShellDiscovery } from "./profiles/discovery";
import { createNodeDetectFs, nodeExecFile } from "./profiles/node-detect";
import { NodePtyAdapter, parseWindowsBuildNumber } from "./sessions/NodePtyAdapter";
import { TerminalSessionManager } from "./sessions/TerminalSessionManager";

export { createTerminalMainEntry } from "./entry";

const isWindows = process.platform === "win32";

/**
 * kilo.terminal's main entry: shells through node-pty, found on this machine
 * (read at each call, so detection sees the login shell's environment), and
 * origin's storage (a sibling plugin folder, `plugins/terminal`) as the
 * one-time source of saved transcripts.
 */
export const terminalMainEntry = createTerminalMainEntry({
	createManager: (deps) => new TerminalSessionManager({ adapter: new NodePtyAdapter(), ...deps }),
	shells: createShellDiscovery(() => ({
		platform: process.platform,
		env: process.env,
		fs: createNodeDetectFs(process.platform),
		execFile: nodeExecFile,
		arch: process.arch,
		homedir: os.homedir(),
		cwd: os.homedir(),
		windowsBuild: isWindows ? parseWindowsBuildNumber(os.release()) : undefined,
		loginShells: isWindows ? [] : loginShellsOf(process.env, () => os.userInfo()),
	})),
	originStorageDir: (sdk) => path.join(mainHost(sdk).storage.dir, "..", "terminal"),
});
