import type { KiloClient } from "@kilocode/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import { withMcpWarmup } from "./with-mcp-warmup";

function fakeClient() {
	const calls: string[] = [];
	const status = vi.fn(async (..._args: unknown[]) => {
		calls.push("mcp.status");
		return { data: {} };
	});
	const promptAsync = vi.fn(async (..._args: unknown[]) => {
		calls.push("session.promptAsync");
		return { data: undefined };
	});
	const get = vi.fn(async () => ({ data: { id: "ses_1" } }));
	const client = { mcp: { status }, session: { promptAsync, get } } as unknown as KiloClient;
	return { client, calls, status, promptAsync, get };
}

describe("withMcpWarmup", () => {
	it("wraps a client once, so asking again for the same client does not warm again", () => {
		const { client, status } = fakeClient();

		const first = withMcpWarmup(client);
		const second = withMcpWarmup(client);

		expect(second).toBe(first);
		expect(status).toHaveBeenCalledOnce();
	});

	it("never lets Stop cancel the warm-up: the status request carries no abort signal", async () => {
		const { client, status } = fakeClient();
		const wrapped = withMcpWarmup(client);
		const stop = new AbortController();

		await wrapped.session.promptAsync({ sessionID: "ses_1", parts: [] }, { signal: stop.signal });

		for (const args of status.mock.calls) {
			expect(JSON.stringify(args)).not.toContain("signal");
			expect(args.some((arg) => arg instanceof AbortSignal)).toBe(false);
		}
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
