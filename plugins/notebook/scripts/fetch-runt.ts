import path from "node:path";

import { stageRunt } from "../src/main/distribution/stage-runt.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const sourceBinaryPath = process.env["RUNT_BINARY"]?.trim();
const result = await stageRunt({
	resourceRoot: path.join(pluginRoot, "resources/runt"),
	...(sourceBinaryPath ? { sourceBinaryPath } : {}),
});

if (!result) {
	console.log(`runt is not published for ${process.platform}/${process.arch}; skipping.`);
} else {
	console.log(
		result.staged
			? `Staged ${result.artifact.assetName} for ${result.artifact.target}.`
			: `runt for ${result.artifact.target} is already current.`,
	);
}
