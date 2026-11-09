import { realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import parcelWatcher from "@parcel/watcher";

import { mainHost } from "@kilo-desktop/kernel";

import { createWorkspacesMainEntry } from "./entry";

export { createWorkspacesMainEntry } from "./entry";

/**
 * kilo.workspaces' main entry: @parcel/watcher for file changes, and origin's
 * kilo-ui database (a sibling plugin folder, `plugins/kilo-ui/data.db`) as the
 * one-time import source.
 */
export const workspacesMainEntry = createWorkspacesMainEntry({
	originDatabase: (sdk) => path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "data.db"),
	watch: {
		subscribeFn: (dir, onEvents, options) => parcelWatcher.subscribe(dir, onEvents, options),
		realpath: promisify(realpath.native),
	},
});
