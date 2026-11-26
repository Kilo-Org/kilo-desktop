import { createServer, type IncomingMessage } from "node:http";

import { test } from "../../fixtures/marketplace.js";
import { KILO_GATEWAY_STUB_URL_ENV } from "../../utils/app-launcher.js";

const MARKETPLACE_MCPS = [
	{
		id: "local-tools",
		name: "Local Tools",
		description: "A deterministic test MCP",
		category: "testing",
		url: "https://github.com/example/local-tools",
		content: JSON.stringify({ command: "node", args: ["local-tools.js"] }),
	},
];

/**
 * Kilo v2 reads the Marketplace catalog from its Kilo API
 * (`<KILO_API_URL>/api/marketplace/{agents,skills,mcps,plugins}`), so this
 * spec's app points its gateway at a server that answers the catalog with
 * one deterministic MCP and forwards every other request to the run's
 * Kilo Gateway stub.
 */
// Read per request: Playwright also loads this file to list tests, before global setup.
const gatewayStub = () => process.env[KILO_GATEWAY_STUB_URL_ENV] ?? "http://127.0.0.1:1";
const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? "/", "http://marketplace").pathname;
	const catalog = pathname.match(/^\/api\/marketplace\/(agents|skills|mcps|plugins)$/);
	if (catalog) {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ items: catalog[1] === "mcps" ? MARKETPLACE_MCPS : [] }));
		return;
	}
	forward(request, gatewayStub()).then(
		async (upstream) => {
			response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
			response.end(Buffer.from(await upstream.arrayBuffer()));
		},
		() => {
			response.writeHead(502);
			response.end();
		},
	);
});

async function forward(request: IncomingMessage, upstream: string): Promise<Response> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === "string" && !["host", "connection", "content-length"].includes(name)) {
			headers.set(name, value);
		}
	}
	const upstreamResponse = await fetch(`${upstream}${request.url ?? "/"}`, {
		method: request.method ?? "GET",
		headers,
		...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
	});
	const body = await upstreamResponse.arrayBuffer();
	const forwarded = new Headers(upstreamResponse.headers);
	forwarded.delete("content-encoding");
	forwarded.delete("content-length");
	forwarded.delete("transfer-encoding");
	return new Response(body, { status: upstreamResponse.status, headers: forwarded });
}

await new Promise<void>((resolve, reject) => {
	server.once("listening", resolve);
	server.once("error", reject);
	server.listen(0, "127.0.0.1");
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Marketplace fixture failed to bind.");

test.use({
	appIsolationKey: "kilo-marketplace",
	appLaunchEnv: {
		[KILO_GATEWAY_STUB_URL_ENV]: `http://127.0.0.1:${address.port}`,
	},
});

test.afterAll(() => {
	server.closeAllConnections();
	server.close();
});

test.describe("Agent Behavior settings @smoke", () => {
	test("installs and removes a global MCP", async ({ appShellPage, marketplacePage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await marketplacePage.openFromSettings();
		await marketplacePage.installGlobalMcp("node local-tools.js");
		await marketplacePage.removeGlobalMcp();
		await appShellPage.leaveSettings();
	});
});
