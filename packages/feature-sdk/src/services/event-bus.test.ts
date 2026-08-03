import { describe, expect, it, vi } from "vitest";

import { emitFeatureEvent, EventBus } from "./event-bus.js";

describe("EventBus", () => {
	it("handler errors do not propagate to other handlers", () => {
		const bus = new EventBus();
		const results: string[] = [];
		bus.on("test", () => {
			throw new Error("fail");
		});
		bus.on("test", () => results.push("ok"));
		bus.emit("test");
		expect(results).toEqual(["ok"]);
	});

	it("handlers subscribed during emit do not receive the in-flight event", () => {
		const bus = new EventBus();
		let lateCalls = 0;
		bus.on("test", () => {
			bus.on("test", () => {
				lateCalls += 1;
			});
		});
		bus.emit("test");
		expect(lateCalls).toBe(0);
		bus.emit("test");
		expect(lateCalls).toBe(1);
	});

	it("removeByPrefix removes only matching handlers", () => {
		const bus = new EventBus();
		let aCalled = false;
		let bCalled = false;
		bus.on("todos.created", () => {
			aCalled = true;
		});
		bus.on("other.event", () => {
			bCalled = true;
		});
		bus.removeByPrefix("todos.");
		bus.emit("todos.created");
		bus.emit("other.event");
		expect(aCalled).toBe(false);
		expect(bCalled).toBe(true);
	});

	it("isolates relay failures after local delivery", () => {
		const bus = new EventBus();
		const received = vi.fn();
		const relayError = new Error("renderer unavailable");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		bus.on("producer.changed", received);

		try {
			expect(() =>
				emitFeatureEvent(
					bus,
					{ featureId: "producer", name: "changed", payload: { id: "1" } },
					() => {
						throw relayError;
					},
				),
			).not.toThrow();

			expect(received).toHaveBeenCalledWith({ id: "1" });
			expect(warn).toHaveBeenCalledWith(
				'[FeatureEvent] Relay for "producer.changed" failed:',
				relayError,
			);
		} finally {
			warn.mockRestore();
		}
	});
});
