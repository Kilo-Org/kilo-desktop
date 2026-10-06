import { RelayBridgeServer, type RelayBridgeServerOptions } from "@mcp-b/webmcp-local-relay";

import {
	WEBMCP_RELAY_ID,
	WEBMCP_RELAY_LABEL,
	WEBMCP_RELAY_PORT,
	WEBMCP_TOOL_SOURCE_ORIGINS,
} from "./webmcp-relay-config.js";
import type { KiloLogger } from "./KiloServerManager.js";
import { WebMcpHttpEndpoint, type WebMcpHttpEndpointConnection } from "./webmcp-http-endpoint.js";

/**
 * Owns Desktop's in-process WebMCP rendezvous and the MCP endpoint that serves
 * it to Kilo, for the lifetime of the kilo-server plugin.
 *
 * - The rendezvous is the fixed loopback WebSocket where the app renderer
 *   registers its tools and where external MCP clients' relay children join.
 * - The endpoint (`WebMcpHttpEndpoint`) serves those tools to `kilo serve`
 *   over MCP Streamable HTTP with a per-launch bearer token.
 *
 * The endpoint only starts once this process owns the rendezvous port in
 * server mode; an existing relay is never silently accepted because its
 * identity cannot be verified through RelayBridgeServer's client-mode API.
 * If the endpoint fails, the rendezvous keeps running for external clients.
 */

export interface WebMcpEndpointHandle {
	start(): Promise<WebMcpHttpEndpointConnection>;
	stop(): Promise<void>;
}

export interface WebMcpRelayServiceOptions {
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly port?: number;
	readonly relayId?: string;
	readonly label?: string;
	readonly createBridge?: (options: RelayBridgeServerOptions) => RelayBridgeServer;
	readonly createEndpoint?: (bridge: RelayBridgeServer) => WebMcpEndpointHandle;
}

export interface WebMcpRelayServiceHandle {
	/**
	 * Resolves the endpoint Kilo should connect to, or undefined when Desktop
	 * does not own the rendezvous port or the endpoint could not start.
	 */
	start(): Promise<WebMcpHttpEndpointConnection | undefined>;
	dispose(): void;
}

export class WebMcpRelayService implements WebMcpRelayServiceHandle {
	readonly #logger: WebMcpRelayServiceOptions["logger"];
	readonly #bridgeOptions: RelayBridgeServerOptions;
	readonly #createBridge: NonNullable<WebMcpRelayServiceOptions["createBridge"]>;
	readonly #createEndpoint: NonNullable<WebMcpRelayServiceOptions["createEndpoint"]>;

	#bridge: RelayBridgeServer | undefined;
	#endpoint: WebMcpEndpointHandle | undefined;
	#connection: WebMcpHttpEndpointConnection | undefined;
	#starting: Promise<WebMcpHttpEndpointConnection | undefined> | undefined;
	#disposed = false;
	readonly #handleBridgeError = (error: Error): void => {
		this.#logger?.warn(`WebMCP rendezvous error: ${error.message}`);
	};

	constructor(options: WebMcpRelayServiceOptions = {}) {
		this.#logger = options.logger;
		this.#bridgeOptions = {
			host: "127.0.0.1",
			port: options.port ?? WEBMCP_RELAY_PORT,
			portExplicitlySet: true,
			relayId: options.relayId ?? WEBMCP_RELAY_ID,
			label: options.label ?? WEBMCP_RELAY_LABEL,
			allowedOrigins: [...WEBMCP_TOOL_SOURCE_ORIGINS],
		};
		this.#createBridge =
			options.createBridge ?? ((bridgeOptions) => new RelayBridgeServer(bridgeOptions));
		this.#createEndpoint =
			options.createEndpoint ?? ((bridge) => new WebMcpHttpEndpoint({ bridge }));
	}

	start(): Promise<WebMcpHttpEndpointConnection | undefined> {
		if (this.#disposed) return Promise.resolve(undefined);
		if (this.#bridge) return Promise.resolve(this.#connection);
		if (this.#starting) return this.#starting;

		this.#starting = this.#startOnce().finally(() => {
			this.#starting = undefined;
		});
		return this.#starting;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const bridge = this.#bridge;
		const endpoint = this.#endpoint;
		this.#bridge = undefined;
		this.#endpoint = undefined;
		this.#connection = undefined;
		void (async () => {
			if (endpoint) await this.#stopEndpoint(endpoint);
			if (bridge) await this.#stop(bridge);
		})();
	}

	async #startOnce(): Promise<WebMcpHttpEndpointConnection | undefined> {
		const bridge = this.#createBridge(this.#bridgeOptions);
		bridge.on("error", this.#handleBridgeError);
		try {
			await bridge.start();
			if (this.#disposed) {
				await this.#stop(bridge);
				return undefined;
			}
			if (bridge.mode !== "server") {
				await this.#stop(bridge);
				this.#logger?.warn(
					`WebMCP rendezvous not started: 127.0.0.1:${bridge.port} is owned by another relay.`,
				);
				return undefined;
			}
		} catch (error) {
			await this.#stop(bridge);
			this.#logger?.warn(
				`WebMCP rendezvous not started: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}

		this.#bridge = bridge;
		this.#logger?.info(`WebMCP rendezvous listening on 127.0.0.1:${bridge.port}.`);
		return this.#startEndpoint(bridge);
	}

	async #startEndpoint(
		bridge: RelayBridgeServer,
	): Promise<WebMcpHttpEndpointConnection | undefined> {
		const endpoint = this.#createEndpoint(bridge);
		try {
			const connection = await endpoint.start();
			if (this.#disposed) {
				await this.#stopEndpoint(endpoint);
				return undefined;
			}
			this.#endpoint = endpoint;
			this.#connection = connection;
			this.#logger?.info(`WebMCP MCP endpoint listening on ${connection.url}.`);
			return connection;
		} catch (error) {
			await this.#stopEndpoint(endpoint);
			this.#logger?.warn(
				`WebMCP MCP endpoint not started: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}

	async #stopEndpoint(endpoint: WebMcpEndpointHandle): Promise<void> {
		try {
			await endpoint.stop();
		} catch (error) {
			this.#logger?.warn(
				`Failed to stop WebMCP MCP endpoint: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async #stop(bridge: RelayBridgeServer): Promise<void> {
		bridge.off("error", this.#handleBridgeError);
		try {
			await bridge.stop();
		} catch (error) {
			this.#logger?.warn(
				`Failed to stop WebMCP rendezvous: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
