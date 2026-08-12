import path from "node:path";

import { buildNotebookUi } from "./notebook-ui-build.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const result = await buildNotebookUi({
	cacheDirectory: path.join(pluginRoot, "build/nteract-source"),
	destinationDirectory: path.join(pluginRoot, "build/notebook"),
});

console.log(
	result.built
		? `Built and staged notebook UI: ${result.destinationDirectory}`
		: `Notebook UI is already current: ${result.destinationDirectory}`,
);
