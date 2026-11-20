import { OpenCode } from "@kilocode/client";

import type { ServerConnection } from "../contracts";

export type KiloV2Client = ReturnType<typeof OpenCode.make>;

/** How often and how long a Kilo RPC waits for its location's plugins to register. */
const PLUGIN_POLL_MS = 100;
const PLUGIN_WAIT_MS = 30_000;

/** A Kilo v2 client for Desktop's own server, authenticated with this launch's credentials. */
export function createServerClient(
	connection: ServerConnection,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): KiloV2Client {
	return OpenCode.make({
		baseUrl: connection.baseUrl,
		headers: {
			authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
		},
		fetch,
	});
}

/**
 * A Kilo RPC failure: the server answers `{ type, message }`, which is not an
 * `Error`, so callers that show `error.message` get the server's words.
 */
export class KiloRpcError extends Error {
	readonly type: string;

	constructor(type: string, message: string) {
		super(message);
		this.name = "KiloRpcError";
		this.type = type;
	}
}

function rpcFailureType(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || error instanceof Error) return undefined;
	return "type" in error && typeof error.type === "string" ? error.type : undefined;
}

/** Turns a Kilo RPC failure into a `KiloRpcError`; any other error passes through. */
export function toKiloError(error: unknown): unknown {
	const type = rpcFailureType(error);
	if (type === undefined) return error;
	const message =
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message
			: type;
	return new KiloRpcError(type, message);
}

/**
 * Resolves once `directory`'s location lists its plugins. Until then it has
 * no Kilo RPCs and no plugin-provided integration methods (Kilo's device
 * sign-in among them). A server without the inventory ends the wait at once.
 */
export async function pluginsListed(client: KiloV2Client, directory: string): Promise<void> {
	const deadline = Date.now() + PLUGIN_WAIT_MS;
	while (Date.now() < deadline) {
		const listed = await client.plugin.list({ location: { directory } }).then(
			(result) => result.data.length > 0,
			// A server without the inventory fails the read: stop waiting.
			() => true,
		);
		if (listed) return;
		await new Promise((resolve) => setTimeout(resolve, PLUGIN_POLL_MS));
	}
}

/**
 * Calls a Kilo RPC method in `directory`'s location. A location answers
 * `rpc.unavailable` until its plugins register (after start and after
 * `location.reload()`), so that answer waits for the plugins and calls once
 * more; only a second one means the server lacks the RPC. Failures come back
 * as `KiloRpcError`.
 */
export async function callRpc<T>(
	client: KiloV2Client,
	directory: string,
	call: (options: { readonly location: { readonly directory: string } }) => Promise<T>,
): Promise<T> {
	const options = { location: { directory } };
	try {
		return await call(options);
	} catch (error) {
		if (rpcFailureType(error) !== "rpc.unavailable") throw toKiloError(error);
		await pluginsListed(client, directory);
		try {
			return await call(options);
		} catch (retryError) {
			throw toKiloError(retryError);
		}
	}
}
