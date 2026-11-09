import { describe, expect, it, vi } from "vitest";

import { GATEWAY_MODELS_FRESH_MS } from "./gateway-models";
import { bootChatMain } from "./test-helpers";

function gatewayFetch() {
	return vi.fn<typeof globalThis.fetch>(async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		return url.includes("bench") || url.includes("enkrypt") || !url.includes("models")
			? Response.json([])
			: Response.json({ data: [{ id: "openai/gpt-5", context_length: 128_000 }] });
	});
}

describe("gateway models", () => {
	it("reads the catalog once for every window while it is fresh", async () => {
		let now = 1_000;
		const fetch = gatewayFetch();
		const { gateway } = await bootChatMain({ withoutAgent: true, fetch, now: () => now });

		await Promise.all([gateway.methods.refresh(undefined), gateway.methods.refresh(undefined)]);
		const calls = fetch.mock.calls.length;
		expect(gateway.getState()).toMatchObject({
			details: [{ modelID: "openai/gpt-5", contextWindow: 128_000 }],
			fetchedAt: 1_000,
		});

		await gateway.methods.refresh(undefined);
		expect(fetch.mock.calls.length).toBe(calls);

		now += GATEWAY_MODELS_FRESH_MS;
		await gateway.methods.refresh(undefined);
		expect(fetch.mock.calls.length).toBeGreaterThan(calls);
	});

	it("keeps the last catalog when a read fails", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("down", { status: 503 }));
		const { gateway } = await bootChatMain({ withoutAgent: true, fetch });

		await expect(gateway.methods.refresh(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		expect(gateway.getState()).toEqual({ details: [], fetchedAt: null });
	});
});
