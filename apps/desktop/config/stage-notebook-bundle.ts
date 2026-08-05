import path from "node:path";
import { fileURLToPath } from "node:url";

import { NOTEBOOK_BUNDLE_STAGING_DIRECTORY, stageNotebookBundle } from "./notebook-bundle-asset.js";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const staged = await stageNotebookBundle({
	destinationDirectory: path.join(packageRoot, NOTEBOOK_BUNDLE_STAGING_DIRECTORY),
});

console.log(
	staged
		? `Staged notebook bundle: ${staged}`
		: "No notebook bundle staged (set NTERACT_BUNDLE to bundle one).",
);
