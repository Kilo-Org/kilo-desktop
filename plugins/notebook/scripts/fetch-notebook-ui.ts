import path from "node:path";

import { stageNotebookUi } from "../src/packaging/staging/stage-notebook-ui.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const result = await stageNotebookUi({
	destinationDirectory: path.join(pluginRoot, "resources/notebook"),
});

console.log(
	result.staged
		? `Staged notebook UI: ${result.destinationDirectory}`
		: `Notebook UI is already current: ${result.destinationDirectory}`,
);
