import { describe, expect, it, vi } from "vitest";

import { FEATURE_PORT_WINDOW_MESSAGE } from "@anaconda-agentic-desktop/contracts";

import { openFeaturePort } from "./featurePorts.js";

describe("openFeaturePort", () => {
	it("transfers one peer with a feature-scoped routing envelope", async () => {
		const received = new Promise<MessageEvent<unknown>>((resolve) =>
			window.addEventListener("message", resolve, { once: true }),
		);

		const localPort = openFeaturePort("notebook", "host", { notebookId: "nb-1" });
		const event = await received;

		expect(event.source).toBe(window);
		expect(event.origin).toBe(window.location.origin);
		expect(event.data).toEqual({
			type: FEATURE_PORT_WINDOW_MESSAGE,
			featureId: "notebook",
			channel: "host",
			args: { notebookId: "nb-1" },
		});
		expect(event.ports).toHaveLength(1);

		const message = vi.fn();
		localPort.addEventListener("message", message);
		localPort.start();
		event.ports[0]!.postMessage("ready");
		await expect.poll(() => message.mock.calls.length).toBe(1);
		localPort.close();
	});

	it("validates feature and channel names before transferring", () => {
		expect(() => openFeaturePort("", "host")).toThrow();
		expect(() => openFeaturePort("notebook", "")).toThrow();
	});
});
