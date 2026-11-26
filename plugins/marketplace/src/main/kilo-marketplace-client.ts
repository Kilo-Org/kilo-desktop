import { OpenCode, type OpenCodeClient } from "@kilocode/client";
import { KiloAgentRpc } from "@kilocode/schema/kilocode/agent";
import { KiloMarketplaceRpc } from "@kilocode/schema/kilocode/marketplace";
import { KiloSkillRpc } from "@kilocode/schema/kilocode/skill";

/** How to reach Kilo's server (`kilo.core/server` `connect`). */
export type KiloConnection = {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
	/** Kilo's global location: Desktop's runtime directory, not a project. */
	readonly globalDirectory: string;
};

export type MarketplaceRecord = KiloMarketplaceRpc.Installed;
export type MarketplaceCatalogItem = KiloMarketplaceRpc.Item;
type CatalogKind = KiloMarketplaceRpc.Kind;
type MarketplaceRpc = ReturnType<typeof marketplaceRpc>;
export type InstallInput = Parameters<MarketplaceRpc["install"]>[0];

function marketplaceRpc(client: OpenCodeClient) {
	return client.rpc(KiloMarketplaceRpc.Definition);
}

/** A failed Kilo RPC, as `client.rpc()` throws it: `{ type, message }`. */
export class KiloRpcError extends Error {
	constructor(
		readonly type: string,
		message: string,
	) {
		super(message);
	}
}

function rpcFailure(error: unknown): { type: string; message: string } | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const { type, message } = error as { type?: unknown; message?: unknown };
	return typeof type === "string" && typeof message === "string" ? { type, message } : undefined;
}

const PLUGINS_WAIT_MS = 30_000;
const PLUGINS_POLL_MS = 100;

/**
 * Kilo's Marketplace and the inventory beside it, in one location (a workspace's
 * primary folder, or Kilo's global location). Calls Kilo v2 through
 * `@kilocode/client` only. Plugin RPCs answer `rpc.unavailable` until the
 * location's plugins are registered, so such an answer waits for the location
 * to list its plugins and calls once more (as kilo.core's `callLocationRpc`
 * does); a second one is final. Other failures reject unchanged, RPC failures
 * as {@link KiloRpcError}.
 */
export class KiloLocation {
	readonly #client: OpenCodeClient;
	readonly #location: { directory: string };
	readonly #marketplace: MarketplaceRpc;
	readonly #waitMs: number;
	readonly #pollMs: number;

	constructor(
		client: OpenCodeClient,
		readonly directory: string,
		options: { readonly waitMs?: number; readonly pollMs?: number } = {},
	) {
		this.#client = client;
		this.#location = { directory };
		this.#marketplace = marketplaceRpc(client);
		this.#waitMs = options.waitMs ?? PLUGINS_WAIT_MS;
		this.#pollMs = options.pollMs ?? PLUGINS_POLL_MS;
	}

	catalog(kind: Exclude<CatalogKind, "plugin">, refresh: boolean) {
		return this.#rpc(() => this.#marketplace.list({ kind, refresh }, this.#options));
	}

	installed() {
		return this.#rpc(() => this.#marketplace.installed({}, this.#options));
	}

	preview(input: InstallInput) {
		return this.#rpc(() => this.#marketplace.preview(input, this.#options));
	}

	install(input: InstallInput) {
		return this.#rpc(() => this.#marketplace.install(input, this.#options));
	}

	uninstall(input: Pick<InstallInput, "registry" | "kind" | "id" | "scope">) {
		return this.#rpc(() => this.#marketplace.uninstall(input, this.#options));
	}

	/** Agents a markdown file in a config directory defines (Kilo's built-in agents have none). */
	removableAgents() {
		return this.#rpc(() => this.#client.rpc(KiloAgentRpc.Definition).removable({}, this.#options));
	}

	/** Manifest paths of the skills that live in a configured skill directory. */
	removableSkills() {
		return this.#rpc(() => this.#client.rpc(KiloSkillRpc.Definition).removable({}, this.#options));
	}

	async agents() {
		await this.pluginsReady();
		return (await this.#client.agent.list({ location: this.#location })).data;
	}

	async skills() {
		await this.pluginsReady();
		return (await this.#client.skill.list({ location: this.#location })).data;
	}

	async mcpServers() {
		await this.pluginsReady();
		return (await this.#client.mcp.list({ location: this.#location })).data;
	}

	async integration(integrationID: string) {
		await this.pluginsReady();
		const listed = await this.#client.integration.list({ location: this.#location });
		return listed.data.find((integration) => integration.id === integrationID);
	}

	async startOAuth(integrationID: string, methodID: string) {
		return (
			await this.#client.integration.oauth.connect({
				integrationID,
				methodID,
				location: this.#location,
			})
		).data;
	}

	async oauthStatus(integrationID: string, attemptID: string) {
		return (
			await this.#client.integration.oauth.status({
				integrationID,
				attemptID,
				location: this.#location,
			})
		).data;
	}

	cancelOAuth(integrationID: string, attemptID: string) {
		return this.#client.integration.oauth.cancel({
			integrationID,
			attemptID,
			location: this.#location,
		});
	}

	/**
	 * Waits until the location lists its plugins (or the wait runs out). Lists
	 * and integrations a plugin contributes are empty or fail unexplained while a
	 * location starts, rather than answering `rpc.unavailable`.
	 */
	async pluginsReady(): Promise<void> {
		const deadline = Date.now() + this.#waitMs;
		while (Date.now() < deadline) {
			// A server without the inventory route ends the wait at once.
			const listed = await this.#client.plugin.list({ location: this.#location }).then(
				(result) => result.data.length > 0,
				() => true,
			);
			if (listed) return;
			await new Promise((resolve) => setTimeout(resolve, this.#pollMs));
		}
	}

	get #options() {
		return { location: this.#location };
	}

	async #rpc<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			const failure = rpcFailure(error);
			if (failure?.type !== "rpc.unavailable") throw asRpcError(error);
			await this.pluginsReady();
			return call().catch((retried: unknown) => {
				throw asRpcError(retried);
			});
		}
	}
}

function asRpcError(error: unknown): unknown {
	const failure = rpcFailure(error);
	return failure ? new KiloRpcError(failure.type, failure.message) : error;
}

/** A Kilo v2 client for the running server, authenticated with its per-launch credentials. */
export function createKiloClient(
	connection: KiloConnection,
	fetch: typeof globalThis.fetch,
): OpenCodeClient {
	const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	return OpenCode.make({
		baseUrl: connection.baseUrl,
		headers: { authorization: `Basic ${credentials}` },
		fetch,
	});
}
