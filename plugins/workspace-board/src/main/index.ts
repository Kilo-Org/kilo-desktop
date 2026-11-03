import { readFile } from "node:fs/promises";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createBoardMainEntry } from "./entry";

export { createBoardMainEntry } from "./entry";

/** Plugin storage is kept per plugin id, beside this plugin's own folder. */
async function readSiblingStorage(
	sdk: PluginSdk,
	pluginId: string,
	file: string,
): Promise<string | null> {
	try {
		return await readFile(path.join(mainHost(sdk).storage.dir, "..", pluginId, file), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * kilo.workspace-board's main entry, adopting once the board it kept as
 * kilo.board, and the board origin kept in kilo-ui's kv.
 */
export const boardMainEntry = createBoardMainEntry({
	readPreviousBoard: (sdk) => readSiblingStorage(sdk, "kilo.board", "board.json"),
	readOriginBoard: (sdk) => readSiblingStorage(sdk, "kilo-ui", "workspace-board.json"),
});
