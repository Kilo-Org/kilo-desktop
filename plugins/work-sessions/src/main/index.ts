import { realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import parcelWatcher from "@parcel/watcher";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createWorkSessionsMainEntry } from "./entry";

export { createWorkSessionsMainEntry, type WorkSessionsMainOptions } from "./entry";

/** Origin's kilo-ui folder sits beside the plugins' storage folders. */
const originFile = (sdk: PluginSdk, name: string) =>
	path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", name);

/**
 * kilo.work-sessions' main entry: @parcel/watcher for file changes, and
 * origin's kilo-ui database and saved layouts as one-time import sources.
 */
export const workSessionsMainEntry = createWorkSessionsMainEntry({
	workspaces: (sdk) => ({ originDatabase: originFile(sdk, "data.db") }),
	fileWatcher: () => ({
		subscribeFn: (dir, onEvents, options) => parcelWatcher.subscribe(dir, onEvents, options),
		realpath: promisify(realpath.native),
	}),
	workSessions: (sdk) => ({ originDatabase: originFile(sdk, "data.db") }),
	layoutPresets: (sdk) => ({ originLayouts: originFile(sdk, "layout-presets.json") }),
});
