import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeKiloServer } from "../../test/fake-kilo-server";
import { retryFailedTurn } from "./retry-failed-turn";

afterEach(() => vi.unstubAllGlobals());

describe("retryFailedTurn", () => {
	it("re-prompts the original message in place and waits for slow snapshots", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "s1", directory: "/repo", title: "Chat" });
		server.install();

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "s1",
			directory: "/repo",
			messageID: "m1",
			model: { providerID: "kilo", modelID: "auto" },
		});

		const [request] = server.requestsTo("POST", "/session/s1/prompt_async");
		expect(request?.directory).toBe("/repo");
		expect(request?.body).toEqual({
			messageID: "m1",
			parts: [],
			model: { providerID: "kilo", modelID: "auto" },
			snapshotInitialization: "wait",
		});
	});

	it("warms the directory's MCP servers before re-prompting, so Stop cannot wedge the chat", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "s2", directory: "/repo-mcp", title: "Chat" });
		server.install();

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "s2",
			directory: "/repo-mcp",
			messageID: "m1",
		});

		const sent = server.requests
			.filter((request) => request.directory === "/repo-mcp")
			.map((request) => `${request.method} ${request.path}`);
		expect(sent.indexOf("GET /mcp")).toBeGreaterThanOrEqual(0);
		expect(sent.indexOf("GET /mcp")).toBeLessThan(sent.indexOf("POST /session/s2/prompt_async"));
	});
});
