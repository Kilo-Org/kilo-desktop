import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { KernelError, type KvStore } from "@kilo-desktop/kernel";

import type {
	ExternalApp as ExternalClient,
	ExternalAppsListener as ExternalClientsStatus,
	ExternalAppsState as ExternalClientsState,
} from "../../../contracts";
import { createCatalogMcpServer } from "./catalog-mcp-server.js";
import { createExternalCatalogView, type CallerPolicy } from "./catalog-view.js";
import { bearerToken, MCP_PATH, McpHttpServer, UNAUTHORIZED } from "./mcp-http-server.js";
import type { ToolCatalog } from "./tool-catalog.js";

export interface StoredExternalClient {
	readonly id: string;
	readonly name: string;
	readonly tokenHash: string;
	readonly createdAt: string;
	readonly lastUsedAt?: string;
}

export type ExternalClientsSettings = {
	enabled: boolean;
	/** `null` means the channel's default port. */
	port: number | null;
	clients: StoredExternalClient[];
};

export const DEFAULT_EXTERNAL_CLIENTS_SETTINGS: ExternalClientsSettings = {
	enabled: false,
	port: null,
	clients: [],
};

export interface ExternalClientsLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface ExternalClientsOptions {
	readonly catalog: ToolCatalog;
	readonly policy: CallerPolicy;
	readonly store: KvStore<ExternalClientsSettings>;
	readonly defaultPort: number;
	readonly logger: ExternalClientsLogger;
	readonly onChange?: (state: ExternalClientsState) => void;
	readonly now?: () => Date;
	/** Whether the feature is available (feature flag); defaults to always. */
	readonly isAvailable?: () => boolean;
}

const UNAVAILABLE = "External AI apps are not available.";
const PAIRING_REQUIRES_ENABLED = "Turn on Allow external AI apps before pairing an app.";

const HOST = "127.0.0.1";
const LAST_USED_PERSIST_INTERVAL_MS = 60_000;

/**
 * Lets paired external AI apps (Cursor, Claude Code, VS Code, ...) use the
 * agent tools over MCP Streamable HTTP on a fixed loopback port.
 *
 * Ownership and invariants:
 * - Off by default. The endpoint listens only while the user has enabled it;
 *   disabling it stops the server and closes every session. Paired clients
 *   are kept, so re-enabling restores access. Apps can be paired only while
 *   it is enabled.
 * - Gated by `isAvailable` (a feature flag). While unavailable the endpoint
 *   never runs, even if the user enabled it earlier, and cannot be enabled or
 *   receive new pairings; `refreshAvailability` follows the flag.
 * - Every request needs the bearer token of a paired client. Tokens are 256
 *   random bits, returned once from `createClient` and persisted only as a
 *   SHA-256 hash, so lookup by hash needs no constant-time comparison.
 *   Revoking a client closes its open sessions at once.
 * - Requests are rejected unless their `Host` is the loopback endpoint itself
 *   (DNS rebinding) and they carry no `Origin` (browsers).
 * - Clients see the tools offered to external apps, never Kilo caller
 *   context. Approving individual calls is the client's responsibility.
 * - A port that cannot be bound leaves the endpoint stopped with an error
 *   status the Settings page shows; nothing retries behind the user's back.
 * - `lastUsedAt` is tracked in memory and persisted at most once a minute per
 *   client, and on stop.
 * - Mutations are serialized so start/stop never interleave.
 */
export class ExternalClientsServer {
	readonly #store: KvStore<ExternalClientsSettings>;
	readonly #defaultPort: number;
	readonly #logger: ExternalClientsLogger;
	readonly #onChange: ((state: ExternalClientsState) => void) | undefined;
	readonly #now: () => Date;
	readonly #isAvailable: () => boolean;
	readonly #http: McpHttpServer<string>;
	/** Token hash (hex) → client id. */
	#clientsByTokenHash = new Map<string, string>();
	readonly #lastUsed = new Map<string, { at: string; persistedAt: number }>();
	#status: ExternalClientsStatus = { status: "stopped" };
	#boundPort: number | undefined;
	#queue: Promise<unknown> = Promise.resolve();
	#disposed = false;

	constructor(options: ExternalClientsOptions) {
		this.#store = options.store;
		this.#defaultPort = options.defaultPort;
		this.#logger = options.logger;
		this.#onChange = options.onChange;
		this.#now = options.now ?? (() => new Date());
		this.#isAvailable = options.isAvailable ?? (() => true);
		this.#indexTokens();
		const view = createExternalCatalogView(options.catalog, options.policy);
		this.#http = new McpHttpServer<string>({
			authorize: (request) => this.#authorize(request),
			createSession: () => createCatalogMcpServer(view),
		});
	}

	/** Start the endpoint if the user left it enabled (re-reading stored clients). */
	init(): Promise<ExternalClientsState> {
		return this.#serialize(async () => {
			this.#indexTokens();
			if (this.#store.get("enabled") && this.#isAvailable()) await this.#start();
		});
	}

	/** Start or stop to match the feature's availability. */
	refreshAvailability(): Promise<ExternalClientsState> {
		return this.#serialize(async () => {
			if (!this.#isAvailable()) await this.#stop();
			else if (this.#store.get("enabled")) await this.#start();
		});
	}

	getState(): ExternalClientsState {
		const settings = this.#store.snapshot();
		return {
			enabled: settings.enabled,
			port: settings.port ?? this.#defaultPort,
			defaultPort: this.#defaultPort,
			listener: this.#status,
			apps: settings.clients.map((client) => this.#publicClient(client)),
		};
	}

	setEnabled(enabled: boolean): Promise<ExternalClientsState> {
		return this.#serialize(async () => {
			if (this.#store.get("enabled") === enabled) return;
			if (enabled && !this.#isAvailable()) throw new KernelError("BUSINESS", UNAVAILABLE);
			this.#store.set({ enabled });
			if (enabled) await this.#start();
			else await this.#stop();
		});
	}

	setPort(port: number | null): Promise<ExternalClientsState> {
		return this.#serialize(async () => {
			this.#store.set({ port });
			if (!this.#store.get("enabled") || !this.#isAvailable()) return;
			await this.#stop();
			await this.#start();
		});
	}

	async createClient(
		name: string,
	): Promise<{ client: ExternalClient; token: string; state: ExternalClientsState }> {
		let created: { client: ExternalClient; token: string } | undefined;
		const state = await this.#serialize(async () => {
			if (!this.#isAvailable()) throw new KernelError("BUSINESS", UNAVAILABLE);
			if (!this.#store.get("enabled")) {
				throw new KernelError("BUSINESS", PAIRING_REQUIRES_ENABLED);
			}
			const token = randomBytes(32).toString("base64url");
			const stored: StoredExternalClient = {
				id: randomUUID(),
				name: name.trim(),
				tokenHash: hashToken(token),
				createdAt: this.#now().toISOString(),
			};
			this.#store.set({ clients: [...this.#store.get("clients"), stored] });
			this.#indexTokens();
			created = { client: this.#publicClient(stored), token };
		});
		return { ...created!, state };
	}

	revokeClient(id: string): Promise<ExternalClientsState> {
		return this.#serialize(async () => {
			this.#store.set({ clients: this.#store.get("clients").filter((client) => client.id !== id) });
			this.#lastUsed.delete(id);
			this.#indexTokens();
			await this.#http.closeSessions((clientId) => clientId === id);
		});
	}

	/** Stops listening; `init` starts again. */
	stop(): Promise<ExternalClientsState> {
		return this.#serialize(() => this.#stop());
	}

	dispose(): Promise<void> {
		this.#disposed = true;
		return this.#serialize(() => this.#stop()).then(() => undefined);
	}

	#serialize(operation: () => Promise<void>): Promise<ExternalClientsState> {
		const run = this.#queue.then(operation, operation);
		this.#queue = run.catch(() => undefined);
		return run.then(() => {
			const state = this.getState();
			this.#onChange?.(state);
			return state;
		});
	}

	async #start(): Promise<void> {
		if (this.#disposed || this.#http.listening) return;
		const port = this.#store.get("port") ?? this.#defaultPort;
		try {
			this.#boundPort = await this.#http.listen(HOST, port);
			const url = `http://${HOST}:${this.#boundPort}${MCP_PATH}`;
			this.#status = { status: "running", url };
			this.#logger.info(`External AI apps endpoint listening on ${url}.`);
		} catch (error) {
			this.#boundPort = undefined;
			this.#status = { status: "error", message: describeListenError(error, port) };
			this.#logger.warn(`External AI apps endpoint not started: ${this.#status.message}`);
		}
	}

	async #stop(): Promise<void> {
		this.#persistLastUsed(true);
		await this.#http.stop();
		this.#boundPort = undefined;
		this.#status = { status: "stopped" };
	}

	#authorize(request: IncomingMessage) {
		if (!isLoopbackHost(request.headers.host, this.#boundPort)) {
			return { ok: false as const, status: 403 };
		}
		const token = bearerToken(request);
		const clientId =
			token === undefined ? undefined : this.#clientsByTokenHash.get(hashToken(token));
		if (clientId === undefined) return UNAUTHORIZED;
		this.#recordUse(clientId);
		return { ok: true as const, principal: clientId };
	}

	#recordUse(clientId: string): void {
		const previous = this.#lastUsed.get(clientId);
		this.#lastUsed.set(clientId, {
			at: this.#now().toISOString(),
			persistedAt: previous?.persistedAt ?? 0,
		});
		this.#persistLastUsed(false);
	}

	#persistLastUsed(force: boolean): void {
		const nowMs = this.#now().getTime();
		let changed = false;
		const clients = this.#store.get("clients").map((client) => {
			const used = this.#lastUsed.get(client.id);
			if (!used || used.at === client.lastUsedAt) return client;
			if (!force && nowMs - used.persistedAt < LAST_USED_PERSIST_INTERVAL_MS) return client;
			used.persistedAt = nowMs;
			changed = true;
			return { ...client, lastUsedAt: used.at };
		});
		if (changed) this.#store.set({ clients });
	}

	#indexTokens(): void {
		this.#clientsByTokenHash = new Map(
			this.#store.get("clients").map((client) => [client.tokenHash, client.id]),
		);
	}

	#publicClient(client: StoredExternalClient): ExternalClient {
		const lastUsedAt = this.#lastUsed.get(client.id)?.at ?? client.lastUsedAt;
		return {
			id: client.id,
			name: client.name,
			createdAt: client.createdAt,
			...(lastUsedAt ? { lastUsedAt } : {}),
		};
	}
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** Only the endpoint's own loopback authority is accepted (DNS-rebinding guard). */
function isLoopbackHost(host: string | undefined, port: number | undefined): boolean {
	if (host === undefined || port === undefined) return false;
	return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function describeListenError(error: unknown, port: number): string {
	const code = (error as { code?: unknown } | undefined)?.code;
	if (code === "EADDRINUSE") return `Port ${port} is already in use. Choose another port.`;
	if (code === "EACCES") return `Port ${port} is not available. Choose another port.`;
	return error instanceof Error ? error.message : String(error);
}
