/**
 * The name a registered tool is served under to AI agents:
 * `<featureId>_<name>`, with anything outside `[A-Za-z0-9_]` replaced by `_`.
 * Agents may add their own prefix (the bundled Kilo CLI adds `desktop_`).
 */
export function agentToolName(tool: { readonly featureId: string; readonly name: string }): string {
	return `${tool.featureId}_${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_");
}
