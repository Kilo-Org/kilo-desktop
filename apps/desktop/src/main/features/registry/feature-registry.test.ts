import { describe, expect, it, vi } from "vitest";

import { createFeatureMessageHandlers, mainEventBus } from "./feature-registry.js";

describe("feature event bridge", () => {
	it("delivers renderer events to main subscribers and relays with the origin id", () => {
		const listener = vi.fn();
		const relay = vi.fn();
		const unsubscribe = mainEventBus.on("renderer-source.changed", listener);
		const event = {
			featureId: "renderer-source",
			name: "changed",
			payload: { id: "1" },
		};

		createFeatureMessageHandlers(relay)["feature:event"](event, { senderId: 42 });

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({ id: "1" });
		expect(relay).toHaveBeenCalledOnce();
		expect(relay).toHaveBeenCalledWith(event, 42);
		unsubscribe();
	});
});
