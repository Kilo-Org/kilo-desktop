import type { KiloClient } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it, vi } from "vitest";

import { withMcpWarmup } from "./with-mcp-warmup";

function fakeClient() {
	const calls: string[] = [];
	const list = vi.fn(async (..._args: unknown[]) => {
		calls.push("mcp.list");
		return { data: [] };
	});
	const prompt = vi.fn(async (..._args: unknown[]) => {
		calls.push("session.prompt");
		return { id: "msg_1" };
	});
	const get = vi.fn(async () => ({ id: "ses_1" }));
	const client = { mcp: { list }, session: { prompt, get } } as unknown as KiloClient;
	return { client, calls, list, prompt, get };
}

describe("withMcpWarmup", () => {
	it("wraps a client once per directory, so asking again does not warm again", () => {
		const { client, list } = fakeClient();

		const first = withMcpWarmup(client, "/app");
		const second = withMcpWarmup(client, "/app");
		const other = withMcpWarmup(client, "/lib");

		expect(second).toBe(first);
		expect(other).not.toBe(first);
		expect(list.mock.calls).toEqual([
			[{ location: { directory: "/app" } }],
			[{ location: { directory: "/lib" } }],
		]);
	});

	it("warms the chat's directory before each prompt, the warm-up first", async () => {
		const { client, calls, get } = fakeClient();
		const wrapped = withMcpWarmup(client, "/app");

		await wrapped.session.prompt({ sessionID: "ses_1", text: "hi" });
		await wrapped.session.get({ sessionID: "ses_1" });

		expect(calls).toEqual(["mcp.list", "mcp.list", "session.prompt"]);
		expect(get).toHaveBeenCalledOnce();
	});

	it("never lets Stop cancel the warm-up: the list request carries no abort signal", async () => {
		const { client, list } = fakeClient();
		const wrapped = withMcpWarmup(client, "/app");
		const stop = new AbortController();

		await wrapped.session.prompt({ sessionID: "ses_1", text: "" }, { signal: stop.signal });

		for (const args of list.mock.calls) {
			expect(JSON.stringify(args)).not.toContain("signal");
			expect(args.some((arg) => arg instanceof AbortSignal)).toBe(false);
		}
	});

	it("still sends the prompt when warm-up fails or MCP is unavailable", async () => {
		const failing = fakeClient();
		failing.list.mockRejectedValue(new Error("server busy"));
		await withMcpWarmup(failing.client, "/app").session.prompt({ sessionID: "ses_1", text: "" });
		expect(failing.prompt).toHaveBeenCalledOnce();

		const prompt = vi.fn(async () => ({ id: "msg_1" }));
		const withoutMcp = { session: { prompt } } as unknown as KiloClient;
		await withMcpWarmup(withoutMcp, "/app").session.prompt({ sessionID: "ses_1", text: "" });
		expect(prompt).toHaveBeenCalledOnce();
	});
});
