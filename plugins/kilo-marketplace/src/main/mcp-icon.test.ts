import { describe, expect, it, vi } from "vitest";

import { McpIconResolver, mcpIconCandidateUrls, resolveMcpIconDataUrl } from "./mcp-icon.js";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const publicLookup = async () => [{ address: "93.184.216.34" }];

describe("MCP icon resolution", () => {
	it("fetches the HTTPS origin favicon without credentials and returns validated image bytes", async () => {
		const fetch = vi.fn(
			async () => new Response(PNG, { headers: { "content-type": "text/html" } }),
		);

		await expect(
			resolveMcpIconDataUrl("https://mcp.example.com/api/mcp", fetch, publicLookup),
		).resolves.toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
		expect(fetch).toHaveBeenCalledWith(new URL("https://mcp.example.com/favicon.ico"), {
			credentials: "omit",
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
	});

	it("rejects insecure URLs, oversized responses, and unrecognized content", async () => {
		const fetch = vi.fn(async () => new Response("<svg></svg>"));
		await expect(
			resolveMcpIconDataUrl("http://mcp.example.com", fetch, publicLookup),
		).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();

		await expect(
			resolveMcpIconDataUrl("https://mcp.example.com", fetch, publicLookup),
		).resolves.toBeUndefined();
		fetch.mockResolvedValueOnce(
			new Response(PNG, { headers: { "content-length": String(64 * 1024 + 1) } }),
		);
		await expect(
			resolveMcpIconDataUrl("https://large.example.com", fetch, publicLookup),
		).resolves.toBeUndefined();
	});

	it("never fetches icons from loopback, private, or reserved destinations", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request) => new Response(PNG));
		const lookup = vi.fn(async (_hostname: string) => [{ address: "192.168.0.10" }]);
		const resolver = new McpIconResolver(fetch, { lookup });

		await expect(
			resolver.resolveFirst([
				"https://127.0.0.1:8080/mcp",
				"https://[::ffff:7f00:1]/mcp",
				"https://localhost/mcp",
				"https://router.local/mcp",
				"https://rebound.example.com/mcp",
			]),
		).resolves.toBeUndefined();
		await expect(
			resolver.resolveExplicit([
				"https://169.254.169.254/icon.png",
				"https://metadata.internal/icon.png",
			]),
		).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("shares one request for MCP URLs on the same origin", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request) => new Response(PNG));
		const resolver = new McpIconResolver(fetch, { lookup: publicLookup });

		await Promise.all([
			resolver.resolve("https://mcp.example.com/one"),
			resolver.resolve("https://mcp.example.com/two"),
		]);

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("prefers remote MCP endpoints embedded in install methods over the project URL", () => {
		expect(
			mcpIconCandidateUrls({
				url: "https://github.com/example/docs-mcp",
				content: [
					{ content: '{"command":"npx","args":["docs-mcp"]}' },
					{ content: '{"type":"remote","url":"https://mcp.docs.example.com/api/mcp"}' },
				],
			}),
		).toEqual(["https://mcp.docs.example.com/api/mcp"]);
	});

	it("never uses GitHub as a favicon source", () => {
		expect(
			mcpIconCandidateUrls({
				url: "https://github.com/example/mcp",
				content: '{"command":"npx","args":["example-mcp"]}',
			}),
		).toEqual([]);
	});

	it("uses a non-GitHub catalog URL for a local integration", () => {
		expect(
			mcpIconCandidateUrls({
				url: "https://firebase.google.com/docs/cli/mcp-server",
				content: '{"command":"npx","args":["firebase-tools","experimental:mcp"]}',
			}),
		).toEqual(["https://firebase.google.com/docs/cli/mcp-server"]);
	});

	it("fetches explicit icon metadata without falling back to GitHub", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request) => new Response(PNG));
		const resolver = new McpIconResolver(fetch, { lookup: publicLookup });

		await expect(
			resolver.resolveExplicit([
				"https://assets.example.com/mcp.png",
				"https://github.com/example/icon.png",
			]),
		).resolves.toMatch(/^data:image\/png;base64,/);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(String(fetch.mock.calls[0]?.[0])).toBe("https://assets.example.com/mcp.png");
	});

	it("tries non-GitHub candidate origins in order until one returns an icon", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("not an icon"))
			.mockResolvedValueOnce(new Response("not an icon"))
			.mockResolvedValueOnce(new Response(PNG));
		const resolver = new McpIconResolver(fetch, { lookup: publicLookup });

		await expect(
			resolver.resolveFirst(["https://mcp.example.com/mcp", "https://docs.example.org/mcp"]),
		).resolves.toMatch(/^data:image\/png;base64,/);
		expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
			"https://example.com/favicon.ico",
			"https://mcp.example.com/favicon.ico",
			"https://example.org/favicon.ico",
		]);
	});

	it("prefers the registrable root domain over an MCP subdomain", async () => {
		const fetch = vi.fn().mockResolvedValueOnce(new Response(PNG));
		const resolver = new McpIconResolver(fetch, { lookup: publicLookup });

		await expect(resolver.resolve("https://mcp.tools.example.co.uk/api/mcp")).resolves.toMatch(
			/^data:image\/png;base64,/,
		);
		expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
			"https://example.co.uk/favicon.ico",
		]);
	});
});
