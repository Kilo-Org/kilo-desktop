import { realpath } from "node:fs/promises";
import path from "node:path";

import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";

type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloGlobalConnection>;
	};
};

type GlobalEvent = {
	directory?: string;
	payload?: { type?: string; properties?: { directory?: string } };
};

export type KiloInstanceDisposer = (directory: string) => Promise<void>;

const DISPOSED_TIMEOUT_MS = 5_000;

/**
 * Disposes the Kilo server's instance for one directory, which stops the MCP
 * servers, file watcher, and other processes it runs there. Windows refuses to
 * rename or delete a directory that is some process's working directory, so a
 * worktree must be released this way before it can be removed.
 *
 * `POST /instance/dispose` only schedules the disposal; the server announces
 * completion (disposers run, MCP processes closed) with a
 * `server.instance.disposed` event, so this subscribes first and waits for it.
 * A server that never announces it is given `timeoutMs` before the caller
 * proceeds anyway.
 */
export function createKiloInstanceDisposer(
	mainSdk: MainSdk,
	createClient: typeof createKiloClient = createKiloClient,
	timeoutMs = DISPOSED_TIMEOUT_MS,
): KiloInstanceDisposer {
	return async (directory) => {
		const connectionService =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		if (!connectionService) throw new Error("Kilo Server is unavailable.");
		const connection = await connectionService.getConnection();
		const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
			"base64",
		);
		const client = createClient({
			baseUrl: connection.baseUrl,
			headers: { Authorization: `Basic ${authorization}` },
		});

		const target = await directoryKey(directory);
		const subscription = new AbortController();
		const deadline = timeout(timeoutMs);
		try {
			const watch = watchForDisposal(client, target, subscription.signal);
			await Promise.race([watch.subscribed, deadline.elapsed]);
			await client.instance.dispose({ directory }, { throwOnError: true });
			await Promise.race([watch.disposed, deadline.elapsed]);
		} finally {
			deadline.cancel();
			subscription.abort();
		}
	};
}

function watchForDisposal(
	client: ReturnType<typeof createKiloClient>,
	target: string,
	signal: AbortSignal,
): { subscribed: Promise<void>; disposed: Promise<void> } {
	let markSubscribed!: () => void;
	const subscribed = new Promise<void>((resolve) => {
		markSubscribed = resolve;
	});
	const disposed = (async () => {
		try {
			const { stream } = await client.global.event({ signal });
			for await (const event of stream as AsyncIterable<GlobalEvent>) {
				// The server's first event confirms the subscription is live, so the
				// dispose request cannot race ahead of it.
				markSubscribed();
				if (event.payload?.type !== "server.instance.disposed") continue;
				const disposedDirectory = event.payload.properties?.directory ?? event.directory;
				if (disposedDirectory && (await directoryKey(disposedDirectory)) === target) return;
			}
		} catch {
			// A failed or aborted subscription falls back to the caller's timeout.
		} finally {
			markSubscribed();
		}
		return new Promise<void>(() => {});
	})();
	return { subscribed, disposed };
}

async function directoryKey(directory: string): Promise<string> {
	const resolved = await realpath(directory).catch(() => path.resolve(directory));
	const trimmed = resolved.replace(/[\\/]+$/, "");
	// Windows and macOS filesystems are case-insensitive by default.
	return process.platform === "linux" ? trimmed : trimmed.toLowerCase();
}

function timeout(ms: number): { elapsed: Promise<void>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const elapsed = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	return { elapsed, cancel: () => clearTimeout(timer) };
}
