import { describe, expect, it } from "vitest";

import { kiloPagesCaller } from "./kilo-pages";

const connection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "1",
	globalDirectory: "/runtime",
};

describe("kiloPagesCaller", () => {
	it("calls the tool on Kilo's global MCP connection, with Basic auth", async () => {
		const requests: { url: string; init: RequestInit }[] = [];
		const pages = kiloPagesCaller({
			connect: async () => connection,
			fetch: async (url, init) => {
				requests.push({ url: url.toString(), init });
				return Response.json({ content: [{ type: "text", text: '{"page_id":"p1"}' }] });
			},
			server: "pages",
		});

		await expect(pages.call("create_page", { title: "Plan" })).resolves.toEqual({ page_id: "p1" });
		expect(requests[0]!.url).toBe(
			"http://127.0.0.1:4321/experimental/mcp/call-tool?directory=%2Fruntime",
		);
		expect(requests[0]!.init.headers).toMatchObject({
			authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}`,
		});
		expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
			server: "pages",
			name: "create_page",
			arguments: { title: "Plan" },
		});
	});

	it("explains an HTTP failure, naming the MCP server", async () => {
		const pages = kiloPagesCaller({
			connect: async () => connection,
			fetch: async () => new Response("no such server", { status: 404 }),
			server: "pages",
		});

		await expect(pages.call("list_projects", {})).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: expect.stringContaining(
				'(404): no such server. Is the "pages" MCP server signed in?',
			),
		});
	});

	it("passes on a tool's own error", async () => {
		const pages = kiloPagesCaller({
			connect: async () => connection,
			fetch: async () =>
				Response.json({
					isError: true,
					content: [{ type: "text", text: '{"error":"Unauthorized"}' }],
				}),
			server: "pages",
		});

		await expect(pages.call("list_projects", {})).rejects.toThrow("Unauthorized");
	});
});
