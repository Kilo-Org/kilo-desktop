import path from "node:path";

import { mainHost } from "@kilo-desktop/kernel";

import { createTerminalMainEntry } from "./entry";
import { NodePtyAdapter } from "./sessions/NodePtyAdapter";
import { TerminalSessionManager } from "./sessions/TerminalSessionManager";

export { createTerminalMainEntry } from "./entry";

/**
 * kilo.terminal's main entry: shells through node-pty, and origin's storage
 * (a sibling plugin folder, `plugins/terminal`) as the one-time source of
 * saved transcripts.
 */
export const terminalMainEntry = createTerminalMainEntry({
	createManager: (deps) => new TerminalSessionManager({ adapter: new NodePtyAdapter(), ...deps }),
	originStorageDir: (sdk) => path.join(mainHost(sdk).storage.dir, "..", "terminal"),
});
