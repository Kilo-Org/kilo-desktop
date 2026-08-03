import { describe, expect, it, vi } from "vitest";

import { createSdk, teardownFeature } from "./create-sdk.js";
import { makeServices, noop, testChannels } from "./test-helpers.js";

describe("createSdk", () => {
	it("returns an SDK with the correct featureId", () => {
		const sdk = createSdk("todos", makeServices());
		expect(sdk.featureId).toBe("todos");
	});

	it("sdk.invoke routes to the feature router", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk
			.channels(testChannels)
			.handle("list", () => [{ id: "1", title: "test", completed: false }]);

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

	it("sdk.events.emit cannot spoof another feature namespace", () => {
		const services = makeServices();
		const sdk = createSdk("producer", services);
		const spoofed = vi.fn();
		const stamped = vi.fn();
		services.eventBus.on("other.changed", spoofed);
		services.eventBus.on("producer.other.changed", stamped);

		sdk.events.emit("other.changed", 1);

		expect(spoofed).not.toHaveBeenCalled();
		expect(stamped).toHaveBeenCalledWith(1);
	});

	it("sdk.events.emit rejects payloads that cannot cross IPC", () => {
		const sdk = createSdk("todos", makeServices());
		expect(() => sdk.events.emit("created", { callback: () => undefined })).toThrow(
			/structured-cloneable/,
		);
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
		sdk.contribute("status-bar", { component: null, label: "Todos" });

		let disposed = false;
		sdk.onDispose(() => {
			disposed = true;
		});

		sdk.destroy();
		expect(disposed).toBe(true);
		expect(services.stateBroker.peek("todos.items")).toBeNull();
		expect(services.capabilityRegistry.get("todos")).toBeNull();
		expect(services.commandRegistry.all()).toEqual([]);
		expect(services.contributionRegistry.getForZone("status-bar")).toEqual([]);
		await expect(sdk.invoke("list")).rejects.toThrow(/destroyed/);
	});

	it("sdk.destroy is instance-scoped: feature handlers and sibling instances survive", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.channels(testChannels).handle("list", () => ["kept"]);

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
		mainSdk.channels(testChannels).handle("list", () => []);
		let backendDisposed = false;
		mainSdk.onDispose(() => {
			backendDisposed = true;
		});

		const sdk = createSdk("todos", services);
		sdk.state.register("items", ["a"]);
		sdk.contribute("status-bar", { component: null, label: "Todos" });

		teardownFeature("todos", services);

		expect(backendDisposed).toBe(true);
		expect(services.featureRouter.has("todos", "list")).toBe(false);
		expect(services.stateBroker.peek("todos.items")).toBeNull();
		expect(services.contributionRegistry.getForZone("status-bar")).toEqual([]);
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

	it("warns when subscribing to an un-namespaced event", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			sdk.events.on("created", noop);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('Did you mean "todos.created"?'));
			warn.mockClear();
			sdk.events.on("todos.created", noop);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("contribute returns an unregister handle that also drops the disposable", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		const remove = sdk.contribute("status-bar", { component: null, label: "Todos" });
		expect(services.contributionRegistry.getForZone("status-bar")).toHaveLength(1);
		remove();
		expect(services.contributionRegistry.getForZone("status-bar")).toEqual([]);
		expect(() => sdk.destroy()).not.toThrow();
	});

	it("sdk.state.has distinguishes registered stores from placeholders", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		expect(sdk.state.has("todos.items")).toBe(false);
		sdk.state.get("todos.items"); // creates a placeholder
		expect(sdk.state.has("todos.items")).toBe(false);
		sdk.state.register("items", []);
		expect(sdk.state.has("todos.items")).toBe(true);
	});

	it("sdk.events.off removes a handler by reference", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		let calls = 0;
		const handler = () => {
			calls += 1;
		};
		sdk.events.on("todos.ping", handler);
		sdk.events.off("todos.ping", handler);
		services.eventBus.emit("todos.ping");
		expect(calls).toBe(0);
	});

	it("sdk.state.peek reads the current value without subscribing", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		expect(sdk.state.peek("todos.items")).toBeNull();
		sdk.state.register("items", ["a"]);
		expect(sdk.state.peek("todos.items")).toEqual(["a"]);
	});

	it("sdk.client proxies method names to invoke", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		mainSdk.channels(testChannels).handle("greet", (args) => `Hi ${args.name}`);
		const sdk = createSdk("todos", services);
		const client = sdk.client as { greet: (args: { name: string }) => Promise<string> };
		await expect(client.greet({ name: "Ada" })).resolves.toBe("Hi Ada");
	});

	it("exposing the same capability twice only registers one dispose cleanup", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		sdk.plugins.expose("svc", { a: 1 });
		sdk.plugins.expose("svc", { a: 2 });
		expect(sdk.plugins.get("todos")).toEqual({ svc: { a: 2 } });
		sdk.destroy();
		expect(services.capabilityRegistry.get("todos")).toBeNull();
	});

	it("deferred surfaces throw until the plugin system lands", () => {
		const sdk = createSdk("todos", makeServices());
		expect(() => sdk.tools.register({})).toThrow(/full plugin system/);
		expect(() => sdk.tools.invoke("f", "t", {})).toThrow(/full plugin system/);
		expect(() => sdk.tools.all()).toThrow(/full plugin system/);
		expect(() => sdk.intents.list()).toThrow(/full plugin system/);
		expect(() => sdk.dispatch({ plugin: "shell", action: "noop" })).toThrow(/full plugin system/);
	});

	it("sdk.navigate forwards to the shell navigation delegate", () => {
		const services = makeServices();
		const navigate = vi.fn();
		services.shellDelegates.navigation.navigate = navigate;
		const sdk = createSdk("todos", services);

		sdk.navigate("/todos", { search: { filter: "open" } });
		expect(navigate).toHaveBeenCalledWith("/todos", { search: { filter: "open" } });

		sdk.destroy();
		expect(() => sdk.navigate("/todos")).toThrow(/destroyed/);
	});

	it("sdk.location subscribes through the delegate and cleans up on destroy", () => {
		const services = makeServices();
		const listeners = new Set<(loc: { path: string; search: Record<string, unknown> }) => void>();
		services.shellDelegates.navigation = {
			navigate: noop,
			subscribe: (fn) => {
				listeners.add(fn);
				fn({ path: "/", search: {} });
				return () => listeners.delete(fn);
			},
			peek: () => ({ path: "/", search: {} }),
		};
		const sdk = createSdk("todos", services);

		expect(sdk.location.peek()).toEqual({ path: "/", search: {} });

		let seen: unknown;
		const unsub = sdk.location.subscribe((loc) => {
			seen = loc;
		});
		expect(seen).toEqual({ path: "/", search: {} });
		expect(listeners.size).toBe(1);

		// Manual unsubscription removes the delegate subscription.
		unsub();
		expect(listeners.size).toBe(0);

		// Subscriptions still alive at destroy() time are cleaned up.
		sdk.location.subscribe(noop);
		expect(listeners.size).toBe(1);
		sdk.destroy();
		expect(listeners.size).toBe(0);
		expect(() => sdk.location.peek()).toThrow(/destroyed/);
	});

	it("destroy is idempotent and isolates throwing dispose callbacks", () => {
		const services = makeServices();
		const sdk = createSdk("todos", services);
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			sdk.onDispose(() => {
				throw new Error("dispose boom");
			});
			let ran = false;
			sdk.onDispose(() => {
				ran = true;
			});
			sdk.destroy();
			expect(ran).toBe(true);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Dispose callback for "todos" threw:'),
				expect.any(Error),
			);
			expect(() => sdk.destroy()).not.toThrow();
		} finally {
			warn.mockRestore();
		}
	});
});
