export interface LocalMcpApp {
	resourceUri: string;
	serverId: string;
}

/**
 * Desktop-local MCP App declarations for tools where the Desktop provides
 * both the tool and its UI. Bypasses the need for relay-level _meta.ui support.
 *
 * Key = MCP wire tool name as seen by Kilo. The WebMCP relay registers as the
 * "desktop" MCP server, so tool names are prefixed: `desktop_<featureId>_<name>`
 * (all sanitized to [A-Za-z0-9_] by McpCatalog.toolName).
 *
 * This map is injected into the patched openCodeMessageProjection via
 * setLocalMcpApps() at runtime startup.
 */
export const LOCAL_MCP_APPS: Record<string, LocalMcpApp> = {
	desktop_environments_conda_envs_list: {
		resourceUri: "ui://environments/conda-envs-list",
		serverId: "desktop",
	},
};
