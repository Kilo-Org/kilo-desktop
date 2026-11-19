import { setLocalMcpApps } from "@assistant-ui/react-opencode";

import type { McpAppImplementation } from "../../contracts";

/** A widget chat may host for a tool, from a `kilo.chat/mcp-app` contribution. */
export interface HostableMcpApp {
	readonly resourceUri: string;
	readonly serverId: string;
	readonly implementation?: McpAppImplementation | undefined;
}

let hostable: ReadonlyMap<string, HostableMcpApp> = new Map();

/**
 * The window's hostable MCP Apps by tool name (the names Kilo calls them by).
 * Remote servers may advertise `_meta.ui` too, but chat only frames widgets
 * contributed here, so nothing else reserves an empty frame. The projection
 * (patched react-opencode) also stamps `mcp.app` on these tools' calls, for
 * Desktop tools whose wire calls carry no `_meta.ui`.
 */
export function setHostableMcpApps(apps: ReadonlyMap<string, HostableMcpApp>): void {
	hostable = apps;
	setLocalMcpApps(
		Object.fromEntries(
			[...apps].map(([tool, app]) => [
				tool,
				{ resourceUri: app.resourceUri, serverId: app.serverId },
			]),
		),
	);
}

/** The hostable widget served from `resourceUri`. */
export function hostableMcpAppByResource(resourceUri: string): HostableMcpApp | undefined {
	for (const app of hostable.values()) if (app.resourceUri === resourceUri) return app;
	return undefined;
}

/** True when chat has a hostable MCP App widget for this tool name. */
export function isHostableMcpAppTool(toolName: string): boolean {
	return hostable.has(toolName);
}
