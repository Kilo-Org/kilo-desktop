import { Server, type Transport } from "@modelcontextprotocol/server";

import type { CatalogView } from "./catalog-view.js";

/** One MCP session's server: connects to exactly one transport. */
export interface McpSessionServer {
	connect(transport: Transport): Promise<void>;
	close(): Promise<void>;
}

const SERVER_INFO = { name: "kilo-desktop", version: "1.0.0" };

/**
 * A low-level MCP server answering `tools/list` and `tools/call` from a
 * catalog view. Handlers read the view on each request, so catalog changes
 * need no per-tool re-registration; the session only announces
 * `tools/list_changed` while it is connected.
 */
export function createCatalogMcpServer(view: CatalogView): McpSessionServer {
	const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: true } } });
	server.setRequestHandler("tools/list", () => ({ tools: view.listTools() }));
	server.setRequestHandler("tools/call", async (request, ctx) => {
		const result = await view.callTool(
			request.params.name,
			request.params.arguments ?? {},
			ctx.mcpReq.signal,
		);
		return server.projectCallToolResult(result, undefined);
	});

	let unsubscribe: (() => void) | undefined;
	return {
		async connect(transport) {
			await server.connect(transport);
			unsubscribe = view.subscribe(() => {
				server.sendToolListChanged().catch(() => undefined);
			});
		},
		async close() {
			unsubscribe?.();
			unsubscribe = undefined;
			await server.close();
		},
	};
}
