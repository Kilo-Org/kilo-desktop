import { describe, expect, it } from "vitest";

import { EventBus } from "./event-bus.js";

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
});
