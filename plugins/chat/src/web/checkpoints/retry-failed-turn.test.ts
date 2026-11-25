import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { session, userMessage } from "../../test/kilo2/fixtures";
import { retryFailedTurn } from "./retry-failed-turn";

afterEach(() => vi.unstubAllGlobals());

function serverWith(prompt = userMessage("Fix the bug")) {
	const server = new FakeKilo2Server();
	server.addChat(
		session("ses_1", {
			directory: "/repo",
			model: { providerID: "kilo", id: "auto", variant: "high" },
		}),
		[prompt],
	);
	server.install();
	return { server, prompt };
}

const promptBodies = (server: FakeKilo2Server) =>
	server.requestsTo("POST", "/api/session/ses_1/prompt").map((request) => request.body);

describe("retryFailedTurn", () => {
	it("sends the failed turn's prompt again, with its files", async () => {
		const { server, prompt } = serverWith(
			userMessage("Describe this", {
				files: [{ data: "aGk=", mime: "image/png", name: "shot.png", source: { type: "inline" } }],
			}),
		);

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "ses_1",
			messageID: prompt.id,
		});

		expect(promptBodies(server)).toEqual([
			{ text: "Describe this", files: [{ uri: "data:image/png;base64,aGk=", name: "shot.png" }] },
		]);
	});

	it("switches to the pane's model first, keeping the session's variant for the same model", async () => {
		const { server, prompt } = serverWith();

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "ses_1",
			messageID: prompt.id,
			model: { providerID: "kilo", modelID: "auto" },
		});
		expect(server.requestsTo("POST", "/api/session/ses_1/model")).toEqual([]);

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "ses_1",
			messageID: prompt.id,
			model: { providerID: "kilo", modelID: "smart" },
		});
		expect(server.requestsTo("POST", "/api/session/ses_1/model").map((r) => r.body)).toEqual([
			{ model: { providerID: "kilo", id: "smart" } },
		]);
	});

	it("warms the chat's MCP servers before sending, so Stop cannot wedge the chat", async () => {
		const { server, prompt } = serverWith();

		await retryFailedTurn({
			connection: server.connection,
			sessionID: "ses_1",
			messageID: prompt.id,
		});

		const sent = server.requests.map((request) => `${request.method} ${request.path}`);
		const warm = server.requests.find((request) => request.path === "/api/mcp");
		expect(warm?.search.get("location[directory]")).toBe("/repo");
		expect(sent.indexOf("GET /api/mcp")).toBeLessThan(
			sent.indexOf("POST /api/session/ses_1/prompt"),
		);
	});

	it("refuses a message that isn't a prompt", async () => {
		const { server } = serverWith();

		await expect(
			retryFailedTurn({ connection: server.connection, sessionID: "ses_1", messageID: "msg_none" }),
		).rejects.toBeDefined();
		expect(promptBodies(server)).toEqual([]);
	});
});
