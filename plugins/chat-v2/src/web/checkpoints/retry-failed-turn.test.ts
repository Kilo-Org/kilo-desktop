import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { retryFailedTurn } from "./retry-failed-turn";

afterEach(() => vi.unstubAllGlobals());

const PNG = { data: "AQID", mime: "image/png", name: "a.png", source: { type: "inline" } };

/** A chat whose turn after `m1` failed. */
function failedChat(id: string, directory: string) {
	const server = new FakeKiloServer();
	server.addChat({
		id,
		directory,
		title: "Chat",
		messages: [
			{ ...userMessage("m1", "Fix the tests"), files: [PNG] },
			assistantMessage("m2", [], { finish: "error" }),
		],
	});
	server.install();
	return server;
}

describe("retryFailedTurn", () => {
	it("sends the failed turn's message again as a new prompt", async () => {
		const server = failedChat("s1", "/repo");

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "s1",
			directory: "/repo",
			messageID: "m1",
			model: { providerID: "kilo", modelID: "auto" },
		});

		expect(server.requestsTo("POST", "/api/session/s1/model")[0]?.body).toEqual({
			model: { providerID: "kilo", id: "auto" },
		});
		expect(server.requestsTo("POST", "/api/session/s1/prompt")[0]?.body).toEqual({
			text: "Fix the tests",
			files: [{ uri: "data:image/png;base64,AQID", source: { type: "inline" }, name: "a.png" }],
		});
	});

	it("switches model only when one is chosen", async () => {
		const server = failedChat("s3", "/repo");

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "s3",
			directory: "/repo",
			messageID: "m1",
		});

		expect(server.requestsTo("POST", "/api/session/s3/model")).toEqual([]);
		expect(server.requestsTo("POST", "/api/session/s3/prompt")[0]?.body).toMatchObject({
			text: "Fix the tests",
		});
	});

	it("refuses to retry what isn't a person's message", async () => {
		const server = failedChat("s4", "/repo");

		await expect(
			retryFailedTurn({
				connection: server.connection,
				sessionID: "s4",
				directory: "/repo",
				messageID: "m2",
			}),
		).rejects.toThrow();
		expect(server.requestsTo("POST", "/api/session/s4/prompt")).toEqual([]);
	});

	it("warms the directory's MCP servers before re-prompting, so Stop cannot wedge the chat", async () => {
		const server = failedChat("s2", "/repo-mcp");

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "s2",
			directory: "/repo-mcp",
			messageID: "m1",
		});

		const sent = server.requests
			.filter((request) => request.directory === "/repo-mcp")
			.map((request) => `${request.method} ${request.path}`);
		expect(sent.indexOf("GET /api/mcp")).toBeGreaterThanOrEqual(0);
		expect(sent.indexOf("GET /api/mcp")).toBeLessThan(sent.indexOf("POST /api/session/s2/prompt"));
	});
});
