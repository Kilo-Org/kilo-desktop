import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { logger } from "@anaconda/playwright-utils/custom-logger";

const DEFAULT_UPSTREAM = "https://api.kilo.ai";
const MODEL_CATALOG_PATH = "/api/openrouter/models";
const SNAPSHOT_ATTEMPTS = 3;
const SNAPSHOT_TIMEOUT_MS = 20_000;
const PROXY_TIMEOUT_MS = 30_000;
/** Headers that describe the upstream hop, not the payload re-sent to the CLI. */
const HOP_HEADERS = new Set([
	"connection",
	"content-encoding",
	"content-length",
	"host",
	"keep-alive",
	"transfer-encoding",
]);

type CatalogSnapshot = { status: number; contentType: string; body: Buffer };

export type KiloGatewayStub = { url: string; close: () => Promise<void> };

/**
 * Local stand-in for the Kilo Gateway that every packaged e2e app points
 * `KILO_API_URL` at.
 *
 * On a cold profile the Kilo CLI fetches the gateway model catalog while
 * building its provider list (10s timeout per attempt), so AI Providers and
 * the model picker waited on the public internet inside a test's 15s budget.
 * The stub captures that catalog once per run, outside any test timeout, and
 * serves it instantly to every worker. If the snapshot cannot be taken the
 * catalog route fails fast with 503, which the CLI already tolerates, rather
 * than letting each test wait out upstream timeouts.
 *
 * Every other route is proxied to the real gateway so unauthenticated calls
 * keep their production behavior.
 */
export async function startKiloGatewayStub(upstream = DEFAULT_UPSTREAM): Promise<KiloGatewayStub> {
	const snapshot = await captureCatalogSnapshot(upstream);
	// The stub runs in the Playwright runner process, where an unhandled
	// rejection would abort the whole run rather than fail one request.
	const server = createServer((request, response) => {
		handle(request, response, upstream, snapshot).catch((error: unknown) => {
			logger.warn(`Kilo Gateway stub failed ${request.method} ${request.url}: ${String(error)}`);
			response.destroy();
		});
	});
	await listen(server);
	const { port } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${port}`;
	logger.info(`Kilo Gateway stub listening at ${url} (catalog snapshot: ${describe(snapshot)}).`);
	return {
		url,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

async function captureCatalogSnapshot(upstream: string): Promise<CatalogSnapshot | undefined> {
	for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
		try {
			const response = await fetch(`${upstream}${MODEL_CATALOG_PATH}`, {
				signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return {
				status: response.status,
				contentType: response.headers.get("content-type") ?? "application/json",
				body: Buffer.from(await response.arrayBuffer()),
			};
		} catch (error) {
			logger.warn(
				`Kilo Gateway catalog snapshot attempt ${attempt}/${SNAPSHOT_ATTEMPTS} failed: ${String(error)}`,
			);
		}
	}
	return undefined;
}

async function handle(
	request: IncomingMessage,
	response: ServerResponse,
	upstream: string,
	snapshot: CatalogSnapshot | undefined,
): Promise<void> {
	const pathname = new URL(request.url ?? "/", "http://stub").pathname;
	if (request.method === "GET" && pathname === MODEL_CATALOG_PATH) {
		serveCatalog(response, snapshot);
		return;
	}
	try {
		await proxy(request, response, upstream);
	} catch (error) {
		if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: `e2e gateway proxy failed: ${String(error)}` }));
	}
}

function serveCatalog(response: ServerResponse, snapshot: CatalogSnapshot | undefined): void {
	if (!snapshot) {
		response.writeHead(503, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: "Kilo Gateway catalog unavailable in e2e" }));
		return;
	}
	response.writeHead(snapshot.status, { "content-type": snapshot.contentType });
	response.end(snapshot.body);
}

/**
 * Buffered rather than streamed: e2e only proxies small unauthenticated JSON
 * calls, never the streaming chat endpoints (specs do not sign in).
 */
async function proxy(
	request: IncomingMessage,
	response: ServerResponse,
	upstream: string,
): Promise<void> {
	const init: RequestInit = {
		headers: forwardableHeaders(request.headers),
		signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
	};
	if (request.method) init.method = request.method;
	if (request.method !== "GET" && request.method !== "HEAD") {
		init.body = new Uint8Array(await readBody(request));
	}
	const upstreamResponse = await fetch(`${upstream}${request.url ?? "/"}`, init);
	const headers: Record<string, string> = {};
	upstreamResponse.headers.forEach((value, name) => {
		if (!HOP_HEADERS.has(name)) headers[name] = value;
	});
	const body = Buffer.from(await upstreamResponse.arrayBuffer());
	response.writeHead(upstreamResponse.status, headers);
	response.end(body);
}

function forwardableHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
	const forwarded: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP_HEADERS.has(name)) continue;
		forwarded[name] = Array.isArray(value) ? value.join(", ") : value;
	}
	return forwarded;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function describe(snapshot: CatalogSnapshot | undefined): string {
	return snapshot ? `${snapshot.body.byteLength} bytes` : "unavailable, serving 503";
}
