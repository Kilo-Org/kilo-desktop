import { describe, expect, it, vi } from "vitest";

import { createFeatureMessageHandlers, featureRouter } from "./feature-registry.js";

describe("feature event bridge", () => {
	it("delivers renderer events to main subscribers and relays with the origin id", () => {
		const listener = vi.fn();
		const relay = vi.fn();
		const unsubscribe = featureRouter.eventBus.on("renderer-source.changed", listener);
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

	it("snapshots the relay before main subscribers can mutate the payload", () => {
		const relay = vi.fn();
		const unsubscribe = featureRouter.eventBus.on("renderer-source.changed", (payload) => {
			(payload as { id: string }).id = "mutated";
		});
		const event = {
			featureId: "renderer-source",
			name: "changed",
			payload: { id: "original" },
		};

		createFeatureMessageHandlers(relay)["feature:event"](event, { senderId: 42 });

		expect(event.payload.id).toBe("mutated");
		expect(relay).toHaveBeenCalledWith(
			{
				featureId: "renderer-source",
				name: "changed",
				payload: { id: "original" },
			},
			42,
		);
		unsubscribe();
	});
});
