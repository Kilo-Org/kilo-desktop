import { describe, expect, it } from "vitest";

import { CapabilityRegistry } from "./capability-registry.js";

describe("CapabilityRegistry", () => {
	it("merges multiple capabilities and remove cleans up empty features", () => {
		const registry = new CapabilityRegistry();
		registry.expose("todos", "a", { x: 1 });
		registry.expose("todos", "b", { y: 2 });
		expect(registry.get("todos")).toEqual({ a: { x: 1 }, b: { y: 2 } });

		registry.remove("todos", "a");
		expect(registry.get("todos")).toEqual({ b: { y: 2 } });

		registry.remove("missing", "nope"); // no-op when feature never exposed
		registry.remove("todos", "b");
		expect(registry.get("todos")).toBeNull();
	});
});
