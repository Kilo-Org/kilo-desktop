import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

/**
 * Dedicated embedded custom-scheme host that renders untrusted MCP App widget
 * HTML. Serving widgets from their own origin (instead of a `blob:` iframe that
 * inherits the app document's CSP) is what lets the trusted app origin drop
 * `script-src 'unsafe-inline'`. See threat-model EoP 7. Shared by the main-side
 * host contribution and the renderer that frames it.
 */
export const MCP_APP_WIDGET_HOST = "mcp-app";
export const MCP_APP_WIDGET_DOCUMENT_PATH = "/widget-host.html";

/**
 * postMessage handshake between the app renderer and the widget shell: the
 * shell announces READY once loaded, the renderer replies with the widget HTML,
 * and the shell writes it into its own (isolated) document.
 */
export const MCP_APP_SHELL_READY_MESSAGE = "mcp-app-shell/ready";
export const MCP_APP_SHELL_HTML_MESSAGE = "mcp-app-shell/html";

export const mcpAppResourceSchema = z.object({
	uri: z.string().min(1),
	mimeType: z.literal("text/html;profile=mcp-app"),
	html: z.string(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

export type McpAppResource = z.infer<typeof mcpAppResourceSchema>;

export const mcpAppsContract = defineContract({
	"mcpApps.readAppResource": defineMethod(
		z.object({ uri: z.string().min(1), serverId: z.string().min(1).optional() }),
		mcpAppResourceSchema,
	),
	"mcpApps.callTool": defineMethod(
		z.object({
			name: z.string().min(1),
			arguments: z.record(z.string(), z.unknown()).optional(),
			serverId: z.string().min(1).optional(),
		}),
		z.unknown(),
	),
	"mcpApps.readResource": defineMethod(
		z.object({ uri: z.string().min(1), serverId: z.string().min(1).optional() }),
		z.unknown(),
	),
	"mcpApps.listResources": defineMethod(
		z.object({ serverId: z.string().min(1).optional() }).optional(),
		z.unknown(),
	),
});

export type McpAppsService = InferContract<typeof mcpAppsContract>;
