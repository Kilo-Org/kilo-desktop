import { describe, expect, it, vi } from "vitest";

import type { ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

import { createKiloMcpAppsHost } from "./mcp-apps-host";

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
} as ServerConnection;

function host(
	respond: (path: string, body: unknown) => Response,
	options: { connection?: ServerConnection | undefined; loadHtml?: () => string } = {},
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = String(input);
		calls.push({ url, init });
		const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
		return respond(new URL(url).pathname + new URL(url).search, body);
	});
	const mcp = createKiloMcpAppsHost({
		connection: () => ("connection" in options ? options.connection : CONNECTION),
		localApp: (uri) =>
			uri === "ui://acme/local"
				? {
						resourceUri: uri,
						serverId: "desktop",
						implementation: options.loadHtml ? { loadHtml: options.loadHtml } : undefined,
					}
				: undefined,
		fetch: fetch as typeof globalThis.fetch,
	});
	return { mcp, calls };
}

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("createKiloMcpAppsHost", () => {
	it("serves a contributed widget's own HTML without asking Kilo", async () => {
		const { mcp, calls } = host(() => json({}), { loadHtml: () => "<p>local</p>" });

		await expect(mcp.loadResource({ uri: "ui://acme/local" })).resolves.toEqual({
			uri: "ui://acme/local",
			mimeType: "text/html;profile=mcp-app",
			html: "<p>local</p>",
		});
		expect(calls).toEqual([]);
	});

	it("reads other widgets from the tool's server, authenticated", async () => {
		const { mcp, calls } = host(() =>
			json({ uri: "ui://acme/x", mimeType: "text/html", text: "<p>x</p>", meta: { a: 1 } }),
		);

		await expect(mcp.loadResource({ uri: "ui://acme/x", serverId: "acme" })).resolves.toEqual({
			uri: "ui://acme/x",
			mimeType: "text/html;profile=mcp-app",
			html: "<p>x</p>",
			meta: { a: 1 },
		});
		expect(calls[0]!.url).toBe("http://127.0.0.1:4096/experimental/resource/read");
		expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
			uri: "ui://acme/x",
			server: "acme",
		});
		expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
			`Basic ${btoa("kilo:secret")}`,
		);
	});

	it("decodes a widget sent as a blob, and refuses resources that aren't apps", async () => {
		const blob = btoa("<p>blob</p>");
		const { mcp } = host((_path, body) =>
			(body as { uri: string }).uri === "ui://acme/blob"
				? json({ mimeType: "text/html;profile=mcp-app", blob })
				: json({ mimeType: "application/json", text: "{}" }),
		);

		await expect(mcp.loadResource({ uri: "ui://acme/blob" })).resolves.toMatchObject({
			uri: "ui://acme/blob",
			html: "<p>blob</p>",
		});
		await expect(mcp.loadResource({ uri: "ui://acme/json" })).rejects.toThrow("is not an MCP App");
	});

	it("calls tools and reads resources for the widget", async () => {
		const { mcp, calls } = host(() => json({ ok: true }));

		await mcp.callTool({ name: "list", arguments: { a: 1 }, serverId: "desktop" });
		await mcp.callTool({ name: "ping" });
		await mcp.readResource({ uri: "ui://acme/data" });
		await mcp.listResources({ serverId: "acme" });
		await mcp.listResources(undefined);

		expect(calls.map((call) => [call.url.replace(CONNECTION.baseUrl, ""), call.init.body])).toEqual(
			[
				[
					"/experimental/mcp/call-tool",
					JSON.stringify({ name: "list", arguments: { a: 1 }, server: "desktop" }),
				],
				["/experimental/mcp/call-tool", JSON.stringify({ name: "ping" })],
				["/experimental/resource/read", JSON.stringify({ uri: "ui://acme/data" })],
				["/experimental/resource?server=acme", undefined],
				["/experimental/resource", undefined],
			],
		);
	});

	it("explains Kilo's failures", async () => {
		const { mcp } = host(() => new Response("boom", { status: 500, statusText: "Server Error" }));

		await expect(mcp.callTool({ name: "list" })).rejects.toThrow(
			"Kilo /experimental/mcp/call-tool failed (500): boom",
		);
	});

	it("fails while Kilo isn't running", async () => {
		const { mcp } = host(() => json({}), { connection: undefined });

		await expect(mcp.readResource({ uri: "ui://x" })).rejects.toThrow("Kilo isn't running.");
	});
});
