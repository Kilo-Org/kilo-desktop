import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ServerConnection } from "../../contracts";
import { createInstanceDisposer } from "./dispose-instance";

/** A Kilo v2 server's `DELETE /api/debug/location`, recorded. */
class FakeKiloServer {
	readonly requests: string[] = [];
	readonly authorizations: (string | undefined)[] = [];
	failEvict = false;
	#server: Server = createServer((request, response) => this.#handle(request, response));

	async start(): Promise<ServerConnection> {
		await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
		const { port } = this.#server.address() as AddressInfo;
		return {
			baseUrl: `http://127.0.0.1:${port}`,
			username: "opencode",
			password: "secret",
			version: "0.0.0-v2-239",
			globalDirectory: "/home",
		};
	}

	async stop(): Promise<void> {
		this.#server.closeAllConnections();
		await new Promise<void>((resolve) => this.#server.close(() => resolve()));
	}

	#handle(request: IncomingMessage, response: ServerResponse) {
		const url = new URL(request.url ?? "/", "http://kilo.test");
		this.authorizations.push(request.headers.authorization);
		if (url.pathname === "/api/debug/location" && request.method === "DELETE") {
			this.requests.push(`evict ${url.searchParams.get("location[directory]") ?? ""}`);
			if (this.failEvict) {
				response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ name: "UnknownError", data: { message: "boom" } }));
				return;
			}
			response.writeHead(204);
			response.end();
			return;
		}
		response.writeHead(404);
		response.end();
	}
}

let server: FakeKiloServer | undefined;
afterEach(async () => {
	await server?.stop();
	server = undefined;
});

describe("disposing a directory's Kilo location", () => {
	it("evicts the directory's location with the server's credentials", async () => {
		server = new FakeKiloServer();
		const connection = await server.start();

		await createInstanceDisposer()(connection, "/projects/app/.kilo/worktrees/fix");

		expect(server.requests).toEqual(["evict /projects/app/.kilo/worktrees/fix"]);
		expect(server.authorizations).toEqual([
			`Basic ${Buffer.from("opencode:secret").toString("base64")}`,
		]);
	});

	it("fails when the server refuses", async () => {
		server = new FakeKiloServer();
		server.failEvict = true;
		const connection = await server.start();

		await expect(createInstanceDisposer()(connection, "/projects/app")).rejects.toBeDefined();
	});
});
