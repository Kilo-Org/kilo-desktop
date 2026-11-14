/**
 * A stand-in for the Kilo app that nteract Pages signs people in through
 * (Pages' `PAGES_KILO_APP_URL`; see `worker/kilo-handoff.mjs` and
 * `kilo-exchange.mjs` in nteract), so the browser and the agent are the same
 * local user without a Kilo account.
 *
 * - `GET /pages-auth` approves every sign-in at once: it sends the browser
 *   back to Pages' callback with a one-time code bound to the sign-in's
 *   `state` (short-lived, single use).
 * - `POST /api/pages-auth/exchange` is Pages' server-to-server call. It
 *   requires the per-run exchange secret (Pages gets it in `.dev.vars`) and
 *   the audience, and accepts either a code it issued or an agent token it
 *   signed, answering with the one local user.
 *
 * Agent tokens are HS256 JWTs under a signing key the caller persists, so a
 * token stays valid across runs and the Kilo server's environment doesn't
 * change. The listener is loopback-only; anyone on this device who could
 * read the plugin's storage could already act as its user.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface PagesUser {
	readonly id: string;
	readonly name: string;
}

export interface IdentityBridgeOptions {
	readonly audience: string;
	readonly signingKey: string;
	/** Where Pages is served (its public origin), read at each sign-in. */
	readonly pagesOrigin: () => string;
	readonly user: PagesUser;
	readonly now?: () => number;
}

export interface IdentityBridge {
	/** `http://127.0.0.1:<port>`: Pages' `PAGES_KILO_APP_URL`. */
	readonly url: string;
	/** Pages' `PAGES_KILO_EXCHANGE_SECRET`, new each run. */
	readonly exchangeSecret: string;
	close(): Promise<void>;
}

export interface AgentTokenOptions {
	readonly audience: string;
	readonly signingKey: string;
	readonly userId: string;
	/** Seconds since the epoch; defaults to now. */
	readonly issuedAt?: number;
	readonly lifetimeSeconds?: number;
}

const CODE_LIFETIME_MS = 2 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (key: string, input: string) =>
	createHmac("sha256", key).update(input).digest("base64url");

function sameText(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/** An agent token the bridge accepts, in the claims Pages reads from a Kilo token. */
export function createAgentToken(options: AgentTokenOptions): string {
	const iat = options.issuedAt ?? Math.floor(Date.now() / 1000);
	const payload = {
		version: 1,
		kiloUserId: options.userId,
		env: "desktop",
		aud: options.audience,
		iat,
		exp: iat + (options.lifetimeSeconds ?? DEFAULT_TOKEN_LIFETIME_SECONDS),
		tokenPurpose: "delegated-workload",
		credentialExchange: false,
	};
	const unsigned = `${base64url(JWT_HEADER)}.${base64url(payload)}`;
	return `${unsigned}.${sign(options.signingKey, unsigned)}`;
}

/** Whether `token` is one of ours, for `audience`, unexpired at `nowSeconds`. */
export function verifyAgentToken(
	token: string,
	options: { audience: string; signingKey: string; nowSeconds: number },
): boolean {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	const [header, payload, signature] = parts as [string, string, string];
	if (!sameText(sign(options.signingKey, `${header}.${payload}`), signature)) return false;
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
			string,
			unknown
		>;
		return (
			claims["aud"] === options.audience &&
			typeof claims["exp"] === "number" &&
			claims["exp"] > options.nowSeconds
		);
	} catch {
		return false;
	}
}

function send(response: ServerResponse, status: number, body?: unknown): void {
	if (body === undefined) {
		response.writeHead(status).end();
		return;
	}
	response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(chunk);
	}
	try {
		const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export async function startIdentityBridge(options: IdentityBridgeOptions): Promise<IdentityBridge> {
	const now = options.now ?? Date.now;
	const exchangeSecret = randomBytes(32).toString("hex");
	const codes = new Map<string, { state: string; expiresAt: number }>();

	const takeCode = (code: string, state: unknown): boolean => {
		const issued = codes.get(code);
		codes.delete(code);
		if (!issued || issued.expiresAt <= now()) return false;
		return state === undefined || state === issued.state;
	};

	const signIn = (url: URL, response: ServerResponse) => {
		const state = url.searchParams.get("state");
		if (url.searchParams.get("audience") !== options.audience || !state) {
			send(response, 400, { error: "invalid_request" });
			return;
		}
		for (const [code, issued] of codes) if (issued.expiresAt <= now()) codes.delete(code);
		const code = randomBytes(24).toString("base64url");
		codes.set(code, { state, expiresAt: now() + CODE_LIFETIME_MS });
		const callback = new URL("/api/auth/kilo/callback", options.pagesOrigin());
		callback.search = new URLSearchParams({ code, state }).toString();
		response.writeHead(302, { location: callback.href }).end();
	};

	const exchange = async (request: IncomingMessage, response: ServerResponse) => {
		const authorization = request.headers.authorization ?? "";
		if (!sameText(authorization, `Bearer ${exchangeSecret}`)) {
			send(response, 401, { error: "invalid_client" });
			return;
		}
		const body = await readJson(request);
		if (body && body["audience"] !== options.audience) {
			send(response, 401, { error: "invalid_client" });
			return;
		}
		const accepted =
			body !== null &&
			(typeof body["code"] === "string"
				? takeCode(body["code"], body["state"])
				: typeof body["token"] === "string" &&
					verifyAgentToken(body["token"], {
						audience: options.audience,
						signingKey: options.signingKey,
						nowSeconds: Math.floor(now() / 1000),
					}));
		if (!accepted) {
			send(response, 400, { error: "invalid_token" });
			return;
		}
		send(response, 200, {
			user: { id: options.user.id, name: options.user.name },
			organizations: [],
		});
	};

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (request.method === "GET" && url.pathname === "/pages-auth") {
			signIn(url, response);
			return;
		}
		if (request.method === "POST" && url.pathname === "/api/pages-auth/exchange") {
			exchange(request, response).catch(() => {
				if (!response.headersSent) send(response, 500);
			});
			return;
		}
		send(response, 404);
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const { port } = server.address() as AddressInfo;

	return {
		url: `http://127.0.0.1:${port}`,
		exchangeSecret,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
