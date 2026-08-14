import { RelayBridgeServer, type RelayBridgeServerOptions } from "@mcp-b/webmcp-local-relay";

import { WEBMCP_RELAY_ID, WEBMCP_RELAY_LABEL, WEBMCP_RELAY_PORT } from "./webmcp-relay-config.js";
import type { KiloLogger } from "./KiloServerManager.js";

/**
 * Owns Desktop's in-process WebMCP WebSocket rendezvous for the lifetime of the
 * kilo-server plugin. It never starts an MCP transport: Kilo's Desktop-provided relay
 * child remains the sole stdio MCP server and joins this bridge in client mode.
 * A successful start always means this process owns the fixed port in server
 * mode; an existing relay is not silently accepted because its relay identity
 * cannot be verified through RelayBridgeServer's client-mode API.
 */

export interface WebMcpRelayBridge {
	readonly mode: "server" | "client";
	readonly port: number;
	on(event: "error", listener: (error: Error) => void): unknown;
	off(event: "error", listener: (error: Error) => void): unknown;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface WebMcpRelayServiceOptions {
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly port?: number;
	readonly relayId?: string;
	readonly label?: string;
	readonly createBridge?: (options: RelayBridgeServerOptions) => WebMcpRelayBridge;
}

export interface WebMcpRelayServiceHandle {
	/** Resolves true only when Desktop owns the fixed rendezvous port. */
	start(): Promise<boolean>;
	dispose(): void;
}

export class WebMcpRelayService implements WebMcpRelayServiceHandle {
	readonly #logger: WebMcpRelayServiceOptions["logger"];
	readonly #bridgeOptions: RelayBridgeServerOptions;
	readonly #createBridge: NonNullable<WebMcpRelayServiceOptions["createBridge"]>;

	#bridge: WebMcpRelayBridge | undefined;
	#starting: Promise<boolean> | undefined;
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
		};
		this.#createBridge =
			options.createBridge ?? ((bridgeOptions) => new RelayBridgeServer(bridgeOptions));
	}

	start(): Promise<boolean> {
		if (this.#disposed) return Promise.resolve(false);
		if (this.#bridge) return Promise.resolve(true);
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
		this.#bridge = undefined;
		if (bridge) void this.#stop(bridge);
	}

	async #startOnce(): Promise<boolean> {
		const bridge = this.#createBridge(this.#bridgeOptions);
		bridge.on("error", this.#handleBridgeError);
		try {
			await bridge.start();
			if (this.#disposed) {
				await this.#stop(bridge);
				return false;
			}
			if (bridge.mode !== "server") {
				await this.#stop(bridge);
				this.#logger?.warn(
					`WebMCP rendezvous not started: 127.0.0.1:${bridge.port} is owned by another relay.`,
				);
				return false;
			}

			this.#bridge = bridge;
			this.#logger?.info(`WebMCP rendezvous listening on 127.0.0.1:${bridge.port}.`);
			return true;
		} catch (error) {
			await this.#stop(bridge);
			this.#logger?.warn(
				`WebMCP rendezvous not started: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	async #stop(bridge: WebMcpRelayBridge): Promise<void> {
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
