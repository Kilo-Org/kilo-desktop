import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import type { McpAppResource, McpAppsService } from "../../contracts/mcp-apps/schemas.js";

/**
 * Local MCP App resource registry.
 *
 * Desktop plugins register their MCP App HTML blobs here at startup. When a
 * renderer requests a resource via `mcpApps.readAppResource`, the local
 * registry is checked first — only if the URI is not found locally does the
 * handler fall through to Kilo CLI.
 */
const localResources = new Map<string, string>();

/** Register a locally-bundled MCP App HTML resource. */
export function registerLocalMcpAppResource(uri: string, html: string): void {
	localResources.set(uri, html);
}

/** Remove a previously registered local resource. */
export function unregisterLocalMcpAppResource(uri: string): void {
	localResources.delete(uri);
}

/**
 * MCP Apps main-process handlers.
 *
 * Proxies renderer requests to the Kilo CLI's experimental resource/tool
 * endpoints. The CLI handles actual MCP server communication; these handlers
 * only forward and validate. Each call fetches the connection lazily so
 * restarts are transparent.
 *
 * Local resources (registered by Desktop plugins) are served first without
 * hitting the network.
 */
export function createMcpAppsHandlers(
	getConnection: () => Promise<KiloGlobalConnection>,
	netFetch: typeof fetch,
): McpAppsService {
	async function post(path: string, body: unknown): Promise<unknown> {
		const connection = await getConnection();
		const auth = Buffer.from(`${connection.username}:${connection.password}`).toString("base64");
		const response = await netFetch(`${connection.baseUrl}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Basic ${auth}`,
			},
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new FeatureError(
				`Kilo CLI ${path} failed (${response.status}): ${text || response.statusText}`,
				"BUSINESS",
			);
		}
		return response.json();
	}

	return {
		"mcpApps.readAppResource": async ({ uri, serverId }) => {
			// Serve from local registry first (Desktop-provided MCP Apps).
			// Presence check (not truthiness) so a registered-but-empty resource
			// is still served locally rather than leaking to a remote fetch.
			if (localResources.has(uri)) {
				return {
					uri,
					mimeType: "text/html;profile=mcp-app",
					html: localResources.get(uri) ?? "",
				} satisfies McpAppResource;
			}

			// Fall through to Kilo CLI for remote MCP server resources
			const result = (await post("/experimental/resource/read", {
				uri,
				...(serverId ? { server: serverId } : {}),
			})) as {
				uri?: string;
				mimeType?: string;
				text?: string;
				blob?: string;
				meta?: Record<string, unknown>;
			};
			if (result.mimeType !== "text/html;profile=mcp-app" && result.mimeType !== "text/html") {
				throw new FeatureError(
					`Resource at ${uri} is not an MCP App (mimeType: ${result.mimeType ?? "unknown"})`,
					"BUSINESS",
				);
			}
			return {
				uri: result.uri ?? uri,
				mimeType: "text/html;profile=mcp-app",
				html:
					result.text ?? (result.blob ? Buffer.from(result.blob, "base64").toString("utf-8") : ""),
				...(result.meta ? { meta: result.meta } : {}),
			} satisfies McpAppResource;
		},

		"mcpApps.callTool": async ({ name, arguments: args, serverId }) => {
			return post("/experimental/mcp/call-tool", {
				name,
				...(args ? { arguments: args } : {}),
				...(serverId ? { server: serverId } : {}),
			});
		},

		"mcpApps.readResource": async ({ uri, serverId }) => {
			return post("/experimental/resource/read", {
				uri,
				...(serverId ? { server: serverId } : {}),
			});
		},

		"mcpApps.listResources": async (params) => {
			const connection = await getConnection();
			const auth = Buffer.from(`${connection.username}:${connection.password}`).toString("base64");
			const url = new URL(`${connection.baseUrl}/experimental/resource`);
			if (params?.serverId) url.searchParams.set("server", params.serverId);
			const response = await netFetch(url.toString(), {
				headers: { Authorization: `Basic ${auth}` },
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new FeatureError(
					`Kilo CLI /experimental/resource failed (${response.status}): ${text || response.statusText}`,
					"BUSINESS",
				);
			}
			return response.json();
		},
	};
}
