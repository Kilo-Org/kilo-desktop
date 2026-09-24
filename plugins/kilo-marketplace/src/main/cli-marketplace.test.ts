import { describe, expect, it, vi } from "vitest";

import { CliMarketplaceClient, CliMarketplaceError } from "./cli-marketplace.js";

const connection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	globalDirectory: "/runtime",
};

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("CliMarketplaceClient", () => {
	it("lists supported catalog items and converts installed scopes", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			response({
				items: [
					{
						type: "agent",
						id: "reviewer",
						name: "Reviewer",
						description: "Reviews code",
						category: "engineering",
						content: { mode: "subagent", description: "Reviews code", prompt: "Review." },
					},
					{ type: "plugin", id: "ignored" },
				],
				installed: {
					project: { "agent:reviewer": { type: "agent" }, "plugin:ignored": { type: "plugin" } },
					global: { "mcp:docs": { type: "mcp" } },
				},
				errors: ["skills unavailable"],
			}),
		);
		const client = new CliMarketplaceClient(connection, fetch);

		await expect(client.list("/workspace")).resolves.toMatchObject({
			items: [{ type: "agent", id: "reviewer" }],
			project: [{ type: "agent", id: "reviewer" }],
			global: [{ type: "mcp", id: "docs" }],
			errors: ["skills unavailable"],
		});
		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toContain("/kilocode/marketplace?directory=%2Fworkspace");
		expect(init?.headers).toMatchObject({
			authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}`,
		});
	});

	it("translates install scope and method for the CLI", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			response({ success: true, slug: "docs", filePath: "/file" }),
		);
		const client = new CliMarketplaceClient(connection, fetch);
		const item = {
			type: "mcp" as const,
			id: "docs",
			name: "Docs",
			description: "Docs",
			category: "knowledge",
			url: "https://example.com",
			content: [{ name: "Remote", content: '{"url":"{{URL}}"}' }],
		};

		await expect(
			client.install("/workspace", item, "project", "Remote", { URL: "x" }),
		).resolves.toBe("/file");
		const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
		expect(body).toEqual({
			item: { type: "mcp", id: "docs", content: item.content },
			target: "project",
			parameters: { URL: "x", __method: "Remote" },
		});
	});

	it("surfaces HTTP-200 operation failures", async () => {
		const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			response({ success: false, slug: "docs", error: "Already installed" }),
		);
		const client = new CliMarketplaceClient(connection, fetch);

		await expect(
			client.remove("/workspace", { type: "mcp", id: "docs" }, "project"),
		).rejects.toEqual(new CliMarketplaceError("Already installed"));
	});
});
