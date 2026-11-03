import { readFile } from "node:fs/promises";
import path from "node:path";

import { mainHost } from "@kilo-desktop/kernel";

import { createChatMainEntry } from "./entry";
import { writeNewFile } from "./html-page-files";

export { createChatMainEntry } from "./entry";

/** kilo.chat's main entry: origin's model preferences (kilo-ui's main kv) adopted once, pages saved with node fs. */
export const chatMainEntry = createChatMainEntry({
	writeNewFile,
	originModelPreferences: async (sdk) => {
		const file = path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "model-preferences.json");
		let raw: string;
		try {
			raw = await readFile(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		try {
			return JSON.parse(raw) as unknown;
		} catch (error) {
			// Corrupt content won't fix itself, so it counts as nothing to adopt rather than a retry.
			sdk.logger.warn("Origin's model preferences are unreadable", error);
			return null;
		}
	},
});
