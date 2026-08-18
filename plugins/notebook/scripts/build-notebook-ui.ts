import path from "node:path";

import { buildNotebookUi } from "../src/packaging/notebook-ui-build.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const result = await buildNotebookUi({
	destinationDirectory: path.join(pluginRoot, "build/notebook"),
});

console.log(
	result.built
		? `Staged notebook UI: ${result.destinationDirectory}`
		: `Notebook UI is already current: ${result.destinationDirectory}`,
);
