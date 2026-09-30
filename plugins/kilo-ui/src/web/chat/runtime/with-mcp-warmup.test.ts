import type { KiloClient } from "@kilocode/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import { withMcpWarmup } from "./with-mcp-warmup.js";

function fakeClient() {
	const calls: string[] = [];
	const status = vi.fn(async () => {
		calls.push("mcp.status");
		return { data: {} };
	});
	const promptAsync = vi.fn(async () => {
		calls.push("session.promptAsync");
		return { data: undefined };
	});
	const get = vi.fn(async () => ({ data: { id: "ses_1" } }));
	const client = { mcp: { status }, session: { promptAsync, get } } as unknown as KiloClient;
	return { client, calls, status, promptAsync, get };
}

describe("withMcpWarmup", () => {
	it("warms MCP as soon as the directory client is created", () => {
		const { client, status } = fakeClient();

		withMcpWarmup(client);

		expect(status).toHaveBeenCalledOnce();
	});

	it("requests MCP status before every prompt so the prompt never owns the MCP connect", async () => {
		const { client, calls } = fakeClient();
		const wrapped = withMcpWarmup(client);
		calls.length = 0;

		await wrapped.session.promptAsync({ sessionID: "ses_1", parts: [] });
		await wrapped.session.promptAsync({ sessionID: "ses_1", parts: [] });

		expect(calls).toEqual([
			"mcp.status",
			"session.promptAsync",
			"mcp.status",
			"session.promptAsync",
		]);
	});

	it("leaves non-prompt session calls alone", async () => {
		const { client, status, get } = fakeClient();
		const wrapped = withMcpWarmup(client);
		status.mockClear();

		await wrapped.session.get({ sessionID: "ses_1" });

		expect(get).toHaveBeenCalledOnce();
		expect(status).not.toHaveBeenCalled();
	});

	it("still sends the prompt when warm-up fails or MCP is unavailable", async () => {
		const failing = fakeClient();
		failing.status.mockRejectedValue(new Error("server busy"));
		await withMcpWarmup(failing.client).session.promptAsync({ sessionID: "ses_1", parts: [] });
		expect(failing.promptAsync).toHaveBeenCalledOnce();

		const promptAsync = vi.fn(async () => ({ data: undefined }));
		const withoutMcp = { session: { promptAsync } } as unknown as KiloClient;
		await withMcpWarmup(withoutMcp).session.promptAsync({ sessionID: "ses_1", parts: [] });
		expect(promptAsync).toHaveBeenCalledOnce();
	});
});
