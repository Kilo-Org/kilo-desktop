import path from "node:path";

import { stageRuntimed } from "../src/main/distribution/stage-runtimed.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const sourceBinaryPath = process.env["RUNTIMED_BINARY"]?.trim();
const result = await stageRuntimed({
	resourceRoot: path.join(pluginRoot, "resources/runtimed"),
	...(sourceBinaryPath ? { sourceBinaryPath } : {}),
});

console.log(
	result.staged
		? `Staged ${result.artifact.assetName} for ${result.artifact.target}.`
		: `runtimed for ${result.artifact.target} is already current.`,
);
