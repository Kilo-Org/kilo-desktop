import { afterEach, describe, expect, it, vi } from "vitest";

import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";

const connection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

describe("Kilo runtime clients", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps global requests authenticated and directory-unscoped", async () => {
		const requests: Request[] = [];
		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const request = input instanceof Request ? input : new Request(input, init);
			requests.push(request);

			if (requests.length === 1) {
				return new Response(JSON.stringify({ healthy: true, version: "7.4.20" }), {
					headers: { "content-type": "application/json" },
				});
			}

			return new Response('data: {"type":"server.connected"}\n\n', {
				headers: { "content-type": "text/event-stream" },
			});
		});
		vi.stubGlobal("fetch", fetch);

		const client = createKiloGlobalClient(connection);
		await client.global.health();
		const { stream } = await client.global.event();
		await stream.next();

		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.headers.get("authorization")).toBe(
				`Basic ${globalThis.btoa("kilo-user:kilo-password")}`,
			);
			expect(new URL(request.url).searchParams.has("directory")).toBe(false);
			expect(request.headers.has("x-kilo-directory")).toBe(false);
		}
	});

	it("scopes directory clients without changing authentication", async () => {
		const requests: Request[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof globalThis.fetch>(async (input, init) => {
				requests.push(input instanceof Request ? input : new Request(input, init));
				return Response.json({ healthy: true, version: "7.4.20" });
			}),
		);

		const directory = "/workspaces/kilo project";
		await createKiloDirectoryClient(connection, directory).global.health();

		expect(requests).toHaveLength(1);
		expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe(directory);
		expect(requests[0]!.headers.get("authorization")).toBe(
			`Basic ${globalThis.btoa("kilo-user:kilo-password")}`,
		);
	});
});
