export interface LocalMcpApp {
	resourceUri: string;
	serverId: string;
}

/**
 * Desktop-hosted MCP Apps that chat is allowed to render as widgets.
 *
 * Remote servers (including notebooks) may still advertise `_meta.ui`, but the
 * chat host only has a complete renderer for entries in this map. Anything else
 * is not rendered as a widget, so we do not reserve an empty iframe.
 *
 * Key = MCP wire tool name as seen by Kilo. The WebMCP relay registers as the
 * "desktop" MCP server, so tool names are prefixed: `desktop_<featureId>_<name>`
 * (all sanitized to [A-Za-z0-9_] by McpCatalog.toolName).
 *
 * This map is also injected into the patched openCodeMessageProjection via
 * setLocalMcpApps() so Desktop-owned tools get `mcp.app` even without wire
 * `_meta.ui`.
 */
export const LOCAL_MCP_APPS: Record<string, LocalMcpApp> = {
	desktop_environments_conda_envs_list: {
		resourceUri: "ui://environments/conda-envs-list",
		serverId: "desktop",
	},
};

/** True when chat has a hostable MCP App widget for this tool name. */
export function isHostableMcpAppTool(toolName: string): boolean {
	return Object.hasOwn(LOCAL_MCP_APPS, toolName);
}
