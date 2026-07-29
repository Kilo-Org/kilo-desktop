import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FeatureError } from "../errors.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { CommandRegistry } from "./command-registry.js";
import { ContributionRegistry } from "./contribution-registry.js";
import { EventBus } from "./event-bus.js";
import { FeatureRouter } from "./feature-router.js";
import { StateBroker } from "./state-broker.js";
import { createSdk, teardownFeature } from "./create-sdk.js";
import type { ShellDelegates } from "./create-sdk.js";

const noop = () => {};

function makeServices(featureRouter = new FeatureRouter()) {
	const shellDelegates: ShellDelegates = {
		notifications: { show: noop, setBadge: noop },
		theme: {
			subscribe: (fn) => {
				fn("light");
				return noop;
			},
			peek: () => "light",
		},
		shell: { openExternal: async () => ({ opened: true }), copyText: async () => undefined },
		fs: {
			readFile: async () => "",
			writeFile: async () => undefined,
			exists: async () => false,
			mkdir: async () => undefined,
			readdir: async () => [],
			remove: async () => undefined,
		},
	};

	return {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter,
		shellDelegates,
	};
}

describe("createSdk", () => {
	it("returns an SDK with the correct featureId", () => {
		const sdk = createSdk("todos", makeServices());
		expect(sdk.featureId).toBe("todos");
	});

	it("sdk.invoke routes to the feature router", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.handle("list", null, () => [{ id: "1", title: "test", completed: false }]);

		const sdk = createSdk("todos", services);
		const result = await sdk.invoke("list");
		expect(result).toEqual([{ id: "1", title: "test", completed: false }]);
	});

	it("sdk.events.emit auto-prefixes with featureId", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		let received: unknown = null;
		services.eventBus.on("todos.created", (payload) => {
			received = payload;
		});
		sdk.events.emit("created", { id: "1" });
		expect(received).toEqual({ id: "1" });
	});

	it("sdk.state.register and get work with namespacing", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		const handle = sdk.state.register("items", ["a"]);

		const store = sdk.state.get("todos.items");
		let current: unknown = null;
		store.subscribe((v) => {
			current = v;
		});
		expect(current).toEqual(["a"]);

		handle.set(["a", "b"]);
		expect(current).toEqual(["a", "b"]);
	});

	it("sdk.plugins.expose and get work", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		sdk.plugins.expose("todoService", { list: () => [] });

		const other = createSdk("other", services);
		const cap = other.plugins.get("todos");
		expect(cap).not.toBeNull();
		expect(cap!.todoService).toEqual({ list: expect.any(Function) });
	});

	it("sdk.destroy cleans up instance registrations and dispose callbacks", async () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		sdk.state.register("items", []);
		sdk.plugins.expose("svc", { hello: () => "world" });
		sdk.commands.register({ id: "add", label: "Add", handler: noop });
		sdk.contribute("statusbar", { component: null, label: "Todos" });

		let disposed = false;
		sdk.onDispose(() => {
			disposed = true;
		});

		sdk.destroy();
		expect(disposed).toBe(true);
		expect(services.stateBroker.peek("todos.items")).toBeNull();
		expect(services.capabilityRegistry.get("todos")).toBeNull();
		expect(services.commandRegistry.all()).toEqual([]);
		expect(services.contributionRegistry.getForZone("statusbar")).toEqual([]);
		await expect(sdk.invoke("list")).rejects.toThrow(/destroyed/);
	});

	it("sdk.destroy is instance-scoped: feature handlers and sibling instances survive", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.handle("list", null, () => ["kept"]);

		const a = createSdk("todos", services);
		const b = createSdk("todos", services);
		b.state.register("fromB", "alive");

		a.destroy();

		// b's registrations and the feature's backend handlers are untouched
		expect(services.stateBroker.peek("todos.fromB")).toBe("alive");
		expect(services.featureRouter.has("todos", "list")).toBe(true);
		await expect(b.invoke("list")).resolves.toEqual(["kept"]);
	});

	it("teardownFeature removes everything for the feature", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.handle("list", null, () => []);
		let backendDisposed = false;
		mainSdk.onDispose(() => {
			backendDisposed = true;
		});

		const sdk = createSdk("todos", services);
		sdk.state.register("items", ["a"]);
		sdk.contribute("statusbar", { component: null, label: "Todos" });

		teardownFeature("todos", services);

		expect(backendDisposed).toBe(true);
		expect(services.featureRouter.has("todos", "list")).toBe(false);
		expect(services.stateBroker.peek("todos.items")).toBeNull();
		expect(services.contributionRegistry.getForZone("statusbar")).toEqual([]);
	});

	it("manual event unsubscribe removes the tracked disposable", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		let calls = 0;
		const unsub = sdk.events.on("other.event", () => {
			calls += 1;
		});
		unsub();
		services.eventBus.emit("other.event");
		expect(calls).toBe(0);
		// destroy after manual unsub must not throw (disposable already removed)
		expect(() => sdk.destroy()).not.toThrow();
	});
});

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
});

describe("CommandRegistry", () => {
	it("register returns an unregister function", () => {
		const registry = new CommandRegistry();
		const unregister = registry.register("todos", { id: "add", label: "Add", handler: noop });
		expect(registry.all()).toHaveLength(1);
		unregister();
		expect(registry.all()).toEqual([]);
	});
});

describe("ContributionRegistry", () => {
	it("register returns an unregister function that only removes that contribution", () => {
		const registry = new ContributionRegistry();
		const unregister = registry.register("todos", "statusbar", { component: null, label: "A" });
		registry.register("todos", "statusbar", { component: null, label: "B" });
		unregister();
		expect(registry.getForZone("statusbar").map((c) => c.label)).toEqual(["B"]);
	});
});

describe("FeatureRouter", () => {
	it("createMainSdk + invoke round-trips", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("my-feature");
		mainSdk.handle("greet", null, (args: unknown) => `Hello, ${(args as { name: string }).name}!`);

		const result = await router.invoke("my-feature", "greet", { name: "World" });
		expect(result).toBe("Hello, World!");
	});

	it("throws FeatureError NOT_FOUND on unknown feature or channel", async () => {
		const router = new FeatureRouter();
		await expect(router.invoke("unknown", "nope")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
		});

		const mainSdk = router.createMainSdk("f");
		mainSdk.handle("yes", null, () => "ok");
		await expect(router.invoke("f", "nope")).rejects.toThrow(/No handler for channel/);
	});

	it("validates input against the registered schema", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		const createInput = z.object({ title: z.string().min(1) });
		mainSdk.handle("create", createInput, (args) => args.title.toUpperCase());

		await expect(router.invoke("todos", "create", { title: "hi" })).resolves.toBe("HI");
		await expect(router.invoke("todos", "create", { title: 42 })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
	});

	it("uses the fallback transport when no local handler exists", async () => {
		const calls: unknown[] = [];
		const router = new FeatureRouter({
			fallback: async (featureId, channel, args) => {
				calls.push([featureId, channel, args]);
				return "from-fallback";
			},
		});
		const mainSdk = router.createMainSdk("todos");
		mainSdk.handle("local", null, () => "from-local");

		await expect(router.invoke("todos", "local")).resolves.toBe("from-local");
		await expect(router.invoke("todos", "remote", { x: 1 })).resolves.toBe("from-fallback");
		expect(calls).toEqual([["todos", "remote", { x: 1 }]]);
	});

	it("propagates FeatureError from handlers", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.handle("fail", null, () => {
			throw new FeatureError("Todo not found.", "NOT_FOUND");
		});
		await expect(router.invoke("todos", "fail")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
			message: "Todo not found.",
		});
	});
});
