import { describe, expect, it } from "vitest";

import { StateBroker } from "./state-broker.js";

describe("StateBroker", () => {
	it("lazy get resolves when the store is registered later", () => {
		const broker = new StateBroker();
		const values: unknown[] = [];
		broker.get("todos.items").subscribe((v) => values.push(v));
		expect(values).toEqual([null]);

		broker.register("todos", "items", ["a"]);
		expect(values).toEqual([null, ["a"]]);
	});

	it("re-registering a hydrated store preserves existing subscribers", () => {
		const broker = new StateBroker();
		broker.register("todos", "items", ["a"]);
		const values: unknown[] = [];
		broker.get("todos.items").subscribe((v) => values.push(v));

		const handle = broker.register("todos", "items", ["b"]);
		handle.set(["c"]);
		expect(values).toEqual([["a"], ["b"], ["c"]]);
	});

	it("a throwing subscriber does not starve other subscribers", () => {
		const broker = new StateBroker();
		const handle = broker.register("todos", "items", 0);
		const store = broker.get("todos.items");
		store.subscribe(() => {
			throw new Error("fail");
		});
		let latest: unknown = null;
		store.subscribe((v) => {
			latest = v;
		});
		handle.set(1);
		expect(latest).toBe(1);
	});

	it("removeStore notifies subscribers with null before deletion", () => {
		const broker = new StateBroker();
		broker.register("todos", "items", ["a"]);
		let latest: unknown = "sentinel";
		broker.get("todos.items").subscribe((v) => {
			latest = v;
		});
		broker.removeStore("todos.items");
		expect(latest).toBeNull();
		expect(broker.peek("todos.items")).toBeNull();
	});

	it("unresolvedKeys reports placeholders that never hydrated", () => {
		const broker = new StateBroker();
		broker.register("todos", "items", []);
		broker.get("todos.items");
		broker.get("todos.typo-key");
		expect(broker.unresolvedKeys()).toEqual(["todos.typo-key"]);
		expect(broker.has("todos.items")).toBe(true);
		expect(broker.has("todos.typo-key")).toBe(false);
	});

	it("store.peek and unsubscribe work; set after remove is a no-op", () => {
		const broker = new StateBroker();
		const handle = broker.register("todos", "items", ["a"]);
		const store = broker.get("todos.items");
		expect(store.peek()).toEqual(["a"]);

		let calls = 0;
		const unsub = store.subscribe(() => {
			calls += 1;
		});
		expect(calls).toBe(1); // sync fire
		unsub();
		handle.set(["b"]);
		expect(calls).toBe(1);

		broker.removeStore("todos.items");
		handle.set(["c"]); // store gone — set is a no-op
		expect(broker.peek("todos.items")).toBeNull();
		broker.removeStore("todos.missing"); // no-op
	});

	it("removeByFeature only removes matching keys", () => {
		const broker = new StateBroker();
		broker.register("todos", "items", 1);
		broker.register("other", "items", 2);
		broker.removeByFeature("todos");
		expect(broker.peek("todos.items")).toBeNull();
		expect(broker.peek("other.items")).toBe(2);
	});
});
