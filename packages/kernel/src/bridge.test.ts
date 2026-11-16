import { describe, expect, it, vi } from "vitest";

import { createBridgeTransport, type KernelBridge } from "./bridge";

function fakeBridge(results: Record<string, unknown> = {}) {
	let deliver: ((channel: string, payload: unknown) => void) | undefined;
	const bridge: KernelBridge = {
		window: { id: "w1", role: "main", params: {} },
		platform: "mac",
		request: vi.fn(async (channel: string) => results[channel] as never),
		send: vi.fn(),
		on: (listener) => {
			deliver = listener;
			return () => {};
		},
		onShortcut: () => () => {},
		getPathForFile: () => null,
	};
	return { bridge, deliver: (channel: string, payload: unknown) => deliver?.(channel, payload) };
}

describe("createBridgeTransport", () => {
	it("unwraps successful results and rethrows kernel errors", async () => {
		const { bridge } = fakeBridge({
			good: { ok: true, value: 7 },
			bad: { ok: false, error: { code: "NOT_FOUND", message: "Missing." } },
		});
		const transport = createBridgeTransport(bridge);

		await expect(transport.request("good", null)).resolves.toBe(7);
		await expect(transport.request("bad", null)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Missing.",
		});
	});

	it("dispatches events from main to listeners of the matching channel", () => {
		const { bridge, deliver } = fakeBridge();
		const transport = createBridgeTransport(bridge);
		const received: unknown[] = [];
		const stop = transport.on("tick", (payload, from) => void received.push([payload, from]));

		deliver("tick", 1);
		deliver("other", 2);
		stop();
		deliver("tick", 3);

		expect(received).toEqual([[1, { process: "main" }]]);
		expect(transport.origin).toEqual({ process: "renderer", windowId: "w1" });
	});
});
