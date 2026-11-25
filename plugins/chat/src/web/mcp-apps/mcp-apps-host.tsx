import type { McpAppsHost } from "@assistant-ui/react";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The pane's MCP App host, which widgets load their HTML, call their tools
 * and read resources through. Kilo v2 has no MCP resource-read or tool-call
 * route (only `mcp.list` and `mcp.resource.catalog`), so there is no host:
 * a call carrying an MCP App renders as its one-line fallback until v2 has
 * those routes.
 */
export const McpAppsHostContext = createContext<McpAppsHost | null>(null);

/** Provides the pane's MCP App host: none on Kilo v2 (see `McpAppsHostContext`). */
export function KiloMcpAppsHostProvider({ children }: { children: ReactNode }) {
	return <McpAppsHostContext.Provider value={null}>{children}</McpAppsHostContext.Provider>;
}

export function useMcpAppsHost(): McpAppsHost | null {
	return useContext(McpAppsHostContext);
}
