import { afterEach, describe, expect, it, vi } from "vitest";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import {
	createMcpAppsHandlers,
	registerLocalMcpAppResource,
	unregisterLocalMcpAppResource,
} from "./mcp-apps-handlers.js";

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:9999",
	username: "user",
	password: "pass",
	version: "1.0.0",
	globalDirectory: "/tmp/kilo",
};

const getConnection = () => Promise.resolve(connection);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

describe("createMcpAppsHandlers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serves a registered local resource without hitting the network", async () => {
		const uri = "ui://environments/conda-envs-list";
		registerLocalMcpAppResource(uri, "<html>local</html>");
		const netFetch = vi.fn<typeof fetch>();
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		const result = await handlers["mcpApps.readAppResource"]({ uri });

		expect(result).toEqual({
			uri,
			mimeType: "text/html;profile=mcp-app",
			html: "<html>local</html>",
		});
		expect(netFetch).not.toHaveBeenCalled();
		unregisterLocalMcpAppResource(uri);
	});

	it("falls through to Kilo CLI for an unregistered resource and decodes text", async () => {
		const netFetch = vi.fn<typeof fetch>().mockResolvedValue(
			jsonResponse({
				uri: "ui://remote/app",
				mimeType: "text/html",
				text: "<html>remote</html>",
			}),
		);
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		const result = await handlers["mcpApps.readAppResource"]({
			uri: "ui://remote/app",
			serverId: "srv",
		});

		expect(result).toEqual({
			uri: "ui://remote/app",
			mimeType: "text/html;profile=mcp-app",
			html: "<html>remote</html>",
		});
		const [url, init] = netFetch.mock.calls[0]!;
		expect(url).toBe("http://127.0.0.1:9999/experimental/resource/read");
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			uri: "ui://remote/app",
			server: "srv",
		});
	});

	it("decodes a base64 blob when no text is present", async () => {
		const html = "<html>blobbed</html>";
		const netFetch = vi.fn<typeof fetch>().mockResolvedValue(
			jsonResponse({
				mimeType: "text/html;profile=mcp-app",
				blob: Buffer.from(html, "utf-8").toString("base64"),
			}),
		);
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		const result = await handlers["mcpApps.readAppResource"]({ uri: "ui://remote/blob" });

		expect(result.html).toBe(html);
	});

	it("rejects a resource that is not an MCP App", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ mimeType: "application/json", text: "{}" }));
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		await expect(handlers["mcpApps.readAppResource"]({ uri: "ui://x/y" })).rejects.toThrow(
			/not an MCP App/,
		);
	});

	it("throws when the Kilo CLI responds with an error status", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("boom", { status: 500, statusText: "Server Error" }));
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		await expect(handlers["mcpApps.readAppResource"]({ uri: "ui://x/y" })).rejects.toThrow(
			/failed \(500\)/,
		);
	});

	it("forwards tool calls with Basic auth and optional arguments", async () => {
		const netFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		await handlers["mcpApps.callTool"]({ name: "do.thing", arguments: { a: 1 }, serverId: "srv" });

		const [url, init] = netFetch.mock.calls[0]!;
		expect(url).toBe("http://127.0.0.1:9999/experimental/mcp/call-tool");
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			name: "do.thing",
			arguments: { a: 1 },
			server: "srv",
		});
	});

	it("forwards readResource to the CLI resource endpoint", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ mimeType: "application/json", text: "{}" }));
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		const result = await handlers["mcpApps.readResource"]({
			uri: "res://data/config",
			serverId: "srv",
		});

		expect(result).toEqual({ mimeType: "application/json", text: "{}" });
		const [url, init] = netFetch.mock.calls[0]!;
		expect(url).toBe("http://127.0.0.1:9999/experimental/resource/read");
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			uri: "res://data/config",
			server: "srv",
		});
	});

	it("lists resources via a GET with an optional server query", async () => {
		const netFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ resources: [] }));
		const handlers = createMcpAppsHandlers(getConnection, netFetch);

		await handlers["mcpApps.listResources"]({ serverId: "srv" });

		const [url] = netFetch.mock.calls[0]!;
		expect(String(url)).toBe("http://127.0.0.1:9999/experimental/resource?server=srv");
	});
});
