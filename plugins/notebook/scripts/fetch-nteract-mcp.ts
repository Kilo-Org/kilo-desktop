import path from "node:path";

import { stageNteractMcp } from "../src/packaging/staging/stage-nteract-mcp.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const sourceNteractMcpPath = process.env["NTERACT_MCP_BINARY"]?.trim();
const sourceRuntPath = process.env["RUNT_BINARY"]?.trim();
const result = await stageNteractMcp({
	resourceRoot: path.join(pluginRoot, "resources/nteract-mcp"),
	...(sourceNteractMcpPath ? { sourceNteractMcpPath } : {}),
	...(sourceRuntPath ? { sourceRuntPath } : {}),
});

console.log(
	result.staged
		? `Staged nteract-mcp and runt for ${result.artifact.target}.`
		: `nteract-mcp for ${result.artifact.target} is already current.`,
);
