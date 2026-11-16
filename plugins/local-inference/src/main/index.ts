import path from "node:path";

import { createLocalInferenceMainEntry } from "./entry";

export { createLocalInferenceMainEntry } from "./entry";

/**
 * kilo.local-inference's main entry, taking over origin's storage (a sibling
 * plugin folder, `plugins/local-inference`) once.
 */
export const localInferenceMainEntry = createLocalInferenceMainEntry({
	originStorageDir: (storageDir) => path.join(storageDir, "..", "local-inference"),
});
