import path from "node:path";

import { createLocalInferenceMainEntry } from "./entry.js";

export { createLocalInferenceMainEntry } from "./entry.js";

/**
 * kilo.local-inference's main entry, taking over origin's storage (a sibling
 * plugin folder, `plugins/local-inference`) once.
 */
export const localInferenceMainEntry = createLocalInferenceMainEntry({
	originStorageDir: (storageDir) => path.join(storageDir, "..", "local-inference"),
});
