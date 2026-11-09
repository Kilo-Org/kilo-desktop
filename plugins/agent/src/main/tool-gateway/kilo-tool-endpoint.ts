import { randomBytes } from "node:crypto";

import { createCatalogMcpServer, type McpSessionServer } from "./catalog-mcp-server.js";
import { createKiloCatalogView, type CallerPolicy, type CatalogView } from "./catalog-view.js";
import { hasBearerToken, MCP_PATH, McpHttpServer, UNAUTHORIZED } from "./mcp-http-server.js";
import type { ToolCatalog } from "./tool-catalog.js";

export interface KiloToolEndpointConnection {
	/** Absolute URL of the MCP endpoint, e.g. `http://127.0.0.1:53817/mcp`. */
	readonly url: string;
	/** Bearer token required on every request; regenerated per endpoint start. */
	readonly token: string;
}

export interface KiloToolEndpointOptions {
	readonly catalog: ToolCatalog;
	readonly policy: CallerPolicy;
	/**
	 * Open sessions kept before the least recently used one is closed. Kilo
	 * opens one session per workspace directory, and a `kilo serve` restart
	 * starts new sessions without ending the old ones.
	 */
	readonly maxSessions?: number;
	/** Builds each session's MCP server. Injected in tests. */
	readonly createSessionServer?: (view: CatalogView) => McpSessionServer;
}

/**
 * Serves the agent tools to the bundled Kilo CLI over MCP Streamable HTTP
 * from the main process: a random loopback port and a bearer token
 * regenerated per start, handed to `kilo serve` through its environment.
 */
export class KiloToolEndpoint {
	readonly #http: McpHttpServer<"kilo">;
	#connection: KiloToolEndpointConnection | undefined;

	constructor(options: KiloToolEndpointOptions) {
		const view = createKiloCatalogView(options.catalog, options.policy);
		const createSessionServer = options.createSessionServer ?? createCatalogMcpServer;
		this.#http = new McpHttpServer<"kilo">({
			authorize: (request) => {
				const token = this.#connection?.token;
				return token !== undefined && hasBearerToken(request, token)
					? { ok: true, principal: "kilo" }
					: UNAUTHORIZED;
			},
			createSession: () => createSessionServer(view),
			...(options.maxSessions !== undefined ? { maxSessions: options.maxSessions } : {}),
		});
	}

	/** Where Kilo reaches the endpoint while it listens. */
	get connection(): KiloToolEndpointConnection | undefined {
		return this.#connection;
	}

	async start(): Promise<KiloToolEndpointConnection> {
		if (this.#connection) return this.#connection;
		const token = randomBytes(32).toString("base64url");
		const port = await this.#http.listen("127.0.0.1", 0);
		this.#connection = { url: `http://127.0.0.1:${port}${MCP_PATH}`, token };
		return this.#connection;
	}

	async stop(): Promise<void> {
		this.#connection = undefined;
		await this.#http.stop();
	}
}
