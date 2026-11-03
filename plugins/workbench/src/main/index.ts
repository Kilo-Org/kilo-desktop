import path from "node:path";

import { mainHost } from "@kilo-desktop/kernel";

import { createWorkbenchMainEntry } from "./entry";

export { createWorkbenchMainEntry } from "./entry";

/** kilo.workbench's main entry, adopting origin's saved layouts once. */
export const workbenchMainEntry = createWorkbenchMainEntry({
	originLayouts: (sdk) =>
		path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "layout-presets.json"),
});
