import { afterEach, describe, expect, it, vi } from "vitest";

import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";

const connection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	directory: "/workspaces/kilo project",
};

describe("createKiloRuntimeClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scopes authenticated REST and SSE requests to the workspace directory", async () => {
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

		const client = createKiloRuntimeClient(connection);
		await client.global.health();
		const { stream } = await client.event.subscribe();
		await stream.next();

		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.headers.get("authorization")).toBe(
				`Basic ${globalThis.btoa("kilo-user:kilo-password")}`,
			);
			expect(new URL(request.url).searchParams.get("directory")).toBe(connection.directory);
			expect(request.headers.has("x-kilo-directory")).toBe(false);
		}
	});
});
