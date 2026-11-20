import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ServerConnection } from "../../contracts";
import { createInstanceDisposer } from "./dispose-instance";

/** The Kilo server's `/global/event` stream and `/instance/dispose`, recorded. */
class FakeKiloServer {
	readonly requests: string[] = [];
	readonly authorizations: (string | undefined)[] = [];
	announce = true;
	failDispose = false;
	#streams: ServerResponse[] = [];
	#server: Server = createServer((request, response) => this.#handle(request, response));

	async start(): Promise<ServerConnection> {
		await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
		const { port } = this.#server.address() as AddressInfo;
		return {
			baseUrl: `http://127.0.0.1:${port}`,
			username: "kilo",
			password: "secret",
			version: "7.8.17",
			globalDirectory: "/home",
		};
	}

	async stop(): Promise<void> {
		for (const stream of this.#streams) stream.end();
		this.#server.closeAllConnections();
		await new Promise<void>((resolve) => this.#server.close(() => resolve()));
	}

	#send(event: unknown) {
		for (const stream of this.#streams) stream.write(`data: ${JSON.stringify(event)}\n\n`);
	}

	#handle(request: IncomingMessage, response: ServerResponse) {
		const url = new URL(request.url ?? "/", "http://kilo.test");
		this.authorizations.push(request.headers.authorization);
		if (url.pathname === "/global/event") {
			this.requests.push("subscribe");
			response.writeHead(200, { "content-type": "text/event-stream" });
			this.#streams.push(response);
			response.write(
				`data: ${JSON.stringify({ payload: { type: "server.connected", properties: {} } })}\n\n`,
			);
			return;
		}
		if (url.pathname === "/instance/dispose" && request.method === "POST") {
			const directory = url.searchParams.get("directory") ?? "";
			this.requests.push(`dispose ${directory}`);
			if (this.failDispose) {
				response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ message: "boom" }));
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end("true");
			if (this.announce) {
				setTimeout(() => {
					this.#send({
						directory: "/elsewhere",
						payload: { type: "server.instance.disposed", properties: { directory: "/elsewhere" } },
					});
					this.#send({
						directory,
						payload: { type: "server.instance.disposed", properties: { directory } },
					});
				}, 20);
			}
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

describe("disposing a directory's Kilo instance", () => {
	it("subscribes first, asks the server, and waits until it says the instance is gone", async () => {
		server = new FakeKiloServer();
		const connection = await server.start();
		const dispose = createInstanceDisposer({ timeoutMs: 10_000 });
		const started = Date.now();

		await dispose(connection, "/projects/app/.kilo/worktrees/fix");

		expect(Date.now() - started).toBeLessThan(5_000);
		expect(server.requests).toEqual(["subscribe", "dispose /projects/app/.kilo/worktrees/fix"]);
		expect(server.authorizations[0]).toBe(`Basic ${Buffer.from("kilo:secret").toString("base64")}`);
	});

	it("carries on once the wait runs out when the server never confirms", async () => {
		server = new FakeKiloServer();
		server.announce = false;
		const connection = await server.start();
		const dispose = createInstanceDisposer({ timeoutMs: 100 });

		await dispose(connection, "/projects/app/.kilo/worktrees/fix");

		expect(server.requests).toContain("dispose /projects/app/.kilo/worktrees/fix");
	});

	it("fails when the server refuses", async () => {
		server = new FakeKiloServer();
		server.failDispose = true;
		const connection = await server.start();
		const dispose = createInstanceDisposer({ timeoutMs: 5_000 });

		await expect(dispose(connection, "/projects/app")).rejects.toMatchObject({ message: "boom" });
	});
});
