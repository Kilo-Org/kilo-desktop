import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod } from "../channel-map.js";
import { FeatureError } from "../errors.js";
import { FeatureRouter } from "./feature-router.js";
import { noop, testChannels } from "./test-helpers.js";

describe("FeatureRouter", () => {
	it("createMainSdk + invoke round-trips", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("my-feature");
		mainSdk.channels(testChannels).handle("greet", (args) => `Hello, ${args.name}!`);

		const result = await router.invoke("my-feature", "greet", { name: "World" });
		expect(result).toBe("Hello, World!");
	});

	it("mainSdk.events stamps namespaces, delivers locally, and relays once", () => {
		const relay = vi.fn();
		const router = new FeatureRouter();
		const producer = router.createMainSdk("producer", { emitEvent: relay });
		const consumer = router.createMainSdk("consumer");
		const received = vi.fn();
		consumer.events.on("producer.changed", received);

		producer.events.emit("changed", { id: "1" });

		expect(received).toHaveBeenCalledOnce();
		expect(received).toHaveBeenCalledWith({ id: "1" });
		expect(relay).toHaveBeenCalledOnce();
		expect(relay).toHaveBeenCalledWith({
			featureId: "producer",
			name: "changed",
			payload: { id: "1" },
		});
	});

	it("snapshots a relay payload before local handlers can mutate it", () => {
		const relay = vi.fn();
		const router = new FeatureRouter();
		const producer = router.createMainSdk("producer", { emitEvent: relay });
		router.eventBus.on("producer.changed", (payload) => {
			(payload as { id: string }).id = "mutated";
		});
		const payload = { id: "original" };

		producer.events.emit("changed", payload);

		expect(payload.id).toBe("mutated");
		expect(relay).toHaveBeenCalledWith({
			featureId: "producer",
			name: "changed",
			payload: { id: "original" },
		});
	});

	it("mainSdk.events rejects payloads that cannot cross IPC", () => {
		const mainSdk = new FeatureRouter().createMainSdk("producer");
		expect(() => mainSdk.events.emit("changed", { callback: () => undefined })).toThrow(
			/structured-cloneable/,
		);
	});

	it("mainSdk.events cannot spoof another feature namespace", () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("producer");
		const spoofed = vi.fn();
		const stamped = vi.fn();
		router.eventBus.on("other.changed", spoofed);
		router.eventBus.on("producer.other.changed", stamped);

		mainSdk.events.emit("other.changed", 1);

		expect(spoofed).not.toHaveBeenCalled();
		expect(stamped).toHaveBeenCalledWith(1);
	});

	it("destroyFeature cleans up main-side event subscriptions", () => {
		const router = new FeatureRouter();
		const consumer = router.createMainSdk("consumer");
		const received = vi.fn();
		const disposed = vi.fn();
		consumer.onDispose(disposed);
		consumer.events.on("producer.changed", received);

		router.destroyFeature("consumer");
		router.eventBus.emit("producer.changed", { id: "1" });

		expect(received).not.toHaveBeenCalled();
		expect(disposed).toHaveBeenCalledOnce();
	});

	it("mainSdk.plugins resolves lazily, degrades to null, and cleans up exposure", () => {
		const router = new FeatureRouter();
		const consumer = router.createMainSdk("consumer");
		const producer = router.createMainSdk("producer");

		expect(consumer.plugins.get("producer")).toBeNull();
		producer.plugins.expose("service", { read: () => "ready" });
		expect(consumer.plugins.get("producer")).toEqual({
			service: { read: expect.any(Function) },
		});

		router.destroyFeature("producer");
		expect(consumer.plugins.get("producer")).toBeNull();
	});

	it("resolves storageDir lazily and caches the result", () => {
		const router = new FeatureRouter();
		const resolveStorageDir = vi.fn(() => "/tmp/plugins/my-feature");
		const mainSdk = router.createMainSdk("my-feature", { resolveStorageDir });

		expect(resolveStorageDir).not.toHaveBeenCalled();
		expect(mainSdk.storageDir).toBe("/tmp/plugins/my-feature");
		expect(mainSdk.storageDir).toBe("/tmp/plugins/my-feature");
		expect(resolveStorageDir).toHaveBeenCalledTimes(1);
	});

	it("throws on storageDir access when no resolver is provided (browser mode)", () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("my-feature");
		expect(() => mainSdk.storageDir).toThrow(/no storage directory/);
	});

	it("resolvePluginAsset delegates to the injected resolver", () => {
		const router = new FeatureRouter();
		const resolvePluginAsset = vi.fn((subpath: string) => `/tmp/plugins/my-feature/${subpath}`);
		const mainSdk = router.createMainSdk("my-feature", { resolvePluginAsset });

		expect(mainSdk.resolvePluginAsset("drizzle")).toBe("/tmp/plugins/my-feature/drizzle");
		expect(mainSdk.resolvePluginAsset("seeds/en.json")).toBe(
			"/tmp/plugins/my-feature/seeds/en.json",
		);
		expect(resolvePluginAsset).toHaveBeenCalledTimes(2);
	});

	it("throws on resolvePluginAsset when no resolver is provided (built-in features, browser mode)", () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("my-feature");
		expect(() => mainSdk.resolvePluginAsset("drizzle")).toThrow(/no plugin asset directory/);
	});

	it("throws FeatureError NOT_FOUND on unknown feature or channel", async () => {
		const router = new FeatureRouter();
		await expect(router.invoke("unknown", "nope")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
		});

		const mainSdk = router.createMainSdk("f");
		mainSdk.channels(testChannels).handle("yes", () => "ok");
		await expect(router.invoke("f", "nope")).rejects.toThrow(/No handler for channel/);
	});

	it("validates input against the channel map", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.channels(testChannels).handle("create", (args) => args.title.toUpperCase());

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
		mainSdk.channels(testChannels).handle("local", () => "from-local");

		await expect(router.invoke("todos", "local")).resolves.toBe("from-local");
		await expect(router.invoke("todos", "remote", { x: 1 })).resolves.toBe("from-fallback");
		expect(calls).toEqual([["todos", "remote", { x: 1 }]]);
	});

	it("propagates FeatureError from handlers", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.channels(testChannels).handle("fail", () => {
			throw new FeatureError("Todo not found.", "NOT_FOUND");
		});
		await expect(router.invoke("todos", "fail")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
			message: "Todo not found.",
		});
	});

	it("warns when a handler is registered twice", () => {
		const router = new FeatureRouter();
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			const mainSdk = router.createMainSdk("todos");
			mainSdk.channels(testChannels).handle("list", () => []);
			// Re-entering createMainSdk reuses existing maps
			const again = router.createMainSdk("todos");
			again.channels(testChannels).handle("list", () => ["replaced"]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Handler for "todos:list" registered twice'),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("handleAll registers every channel from the map", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.channels(testChannels).handleAll({
			list: () => [],
			greet: (args) => `Hi ${args.name}`,
			yes: () => "y",
			create: (args) => args.title,
			local: () => "local",
			fail: () => {
				throw new Error("nope");
			},
		});
		await expect(router.invoke("todos", "yes")).resolves.toBe("y");
		await expect(router.invoke("todos", "greet", { name: "Ada" })).resolves.toBe("Hi Ada");
	});

	it("stringifies non-Error validation failures", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk
			.channels({
				raw: defineMethod(
					{
						parse(value: unknown) {
							if (value !== "ok") throw "bad-input";
							return value;
						},
					},
					z.string(),
				),
			} as const)
			.handle("raw", (v) => v);

		await expect(router.invoke("todos", "raw", "nope")).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
			message: expect.stringContaining("bad-input"),
		});
	});

	it("isolates throwing dispose callbacks and tolerates features with none", () => {
		const router = new FeatureRouter();
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			const mainSdk = router.createMainSdk("todos");
			mainSdk.channels(testChannels).handle("list", () => []);
			mainSdk.onDispose(() => {
				throw new Error("dispose boom");
			});
			router.destroyFeature("todos");
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Dispose callback for "todos" threw:'),
				expect.any(Error),
			);
			expect(router.has("todos", "list")).toBe(false);

			router.createMainSdk("empty");
			expect(() => router.destroyFeature("empty")).not.toThrow();
			expect(() => router.destroyFeature("never-created")).not.toThrow();
		} finally {
			warn.mockRestore();
		}
	});
});
