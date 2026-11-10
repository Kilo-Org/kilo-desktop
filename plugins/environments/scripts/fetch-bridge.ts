import path from "node:path";

import { stageBridge } from "../src/packaging/stage-bridge";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = process.env["BRIDGE_PAYLOAD"]?.trim();

const result = await stageBridge({
	resourceRoot: path.join(pluginRoot, "resources/bridge"),
	...(sourcePath ? { sourcePath } : {}),
});

if (result.staged) {
	console.log(`Staged bridge payload v${result.version}.`);
} else if (result.version === "none") {
	// stageBridge returns version "none" when no payload package is published
	// for this platform/arch (see stage-bridge.ts).
	console.log("No bridge payload available for this platform — nothing staged.");
} else {
	console.log(`Bridge payload v${result.version} is already current.`);
}
