import { mainHost } from "@kilo-desktop/kernel";

import { assetResources } from "./asset-resources.js";
import { createUpdatesMainEntry } from "./entry.js";

export { createUpdatesMainEntry, type LegalResources, type UpdatesMainOptions } from "./entry.js";

/** kilo.updates' main entry, over the packaged app's resources folder. */
export const updatesMainEntry = createUpdatesMainEntry({
	resources: (sdk) => assetResources(mainHost(sdk).assets),
});
