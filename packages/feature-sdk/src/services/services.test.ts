import { describe, expect, it } from "vitest";

import { CapabilityRegistry } from "./capability-registry.js";
import { CommandRegistry } from "./command-registry.js";
import { ContributionRegistry } from "./contribution-registry.js";
import { EventBus } from "./event-bus.js";
import { FeatureRouter } from "./feature-router.js";
import { StateBroker } from "./state-broker.js";
import { createSdk } from "./create-sdk.js";
import type { ShellDelegates } from "./create-sdk.js";

const noop = () => {};

function makeServices() {
	const shellDelegates: ShellDelegates = {
		notifications: { show: noop, setBadge: noop },
		theme: { subscribe: () => noop, peek: () => "light", getEffective: () => "light" },
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
		featureRouter: new FeatureRouter(),
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
		mainSdk.handle("list", () => [{ id: "1", title: "test", completed: false }]);

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

	it("sdk.destroy cleans up everything", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.handle("list", () => []);

		const sdk = createSdk("todos", services);
		sdk.state.register("items", []);
		sdk.plugins.expose("svc", { hello: () => "world" });

		let disposed = false;
		sdk.onDispose(() => {
			disposed = true;
		});

		sdk.destroy();
		expect(disposed).toBe(true);
		await expect(sdk.invoke("list")).rejects.toThrow(/destroyed/);
		expect(services.stateBroker.peek("todos.items")).toBeNull();
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

describe("FeatureRouter", () => {
	it("createMainSdk + invoke round-trips", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("my-feature");
		mainSdk.handle("greet", (args: unknown) => `Hello, ${(args as { name: string }).name}!`);

		const result = await router.invoke("my-feature", "greet", { name: "World" });
		expect(result).toBe("Hello, World!");
	});

	it("throws on unknown feature or channel", async () => {
		const router = new FeatureRouter();
		await expect(router.invoke("unknown", "nope")).rejects.toThrow(/No handlers registered/);

		const mainSdk = router.createMainSdk("f");
		mainSdk.handle("yes", () => "ok");
		await expect(router.invoke("f", "nope")).rejects.toThrow(/No handler for channel/);
	});
});
