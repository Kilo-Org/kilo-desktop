import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
	createLinkedFakeSdkPair,
} from "./index.js";

const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

const todosChannels = {
	list: defineMethod(z.undefined(), z.array(todoSchema)),
	add: defineMethod(z.object({ title: z.string().min(1) }), todoSchema),
} as const;

describe("createFakeMainSdk", () => {
	it("invoke validates input and output like the real router", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		mainSdk.channels(todosChannels).handle("add", ({ title }) => ({
			id: "1",
			title,
			completed: false,
		}));

		await expect(mainSdk.invoke("add", { title: "Milk" })).resolves.toEqual({
			id: "1",
			title: "Milk",
			completed: false,
		});
		await expect(mainSdk.invoke("add", { title: 42 })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
	});

	it("defaults featureId to test-feature when omitted", async () => {
		const mainSdk = createFakeMainSdk();
		mainSdk.channels(todosChannels).handle("list", () => []);
		await expect(mainSdk.invoke("list")).resolves.toEqual([]);
	});

	it("provides a lazily created temp storageDir, stable across accesses", () => {
		const fs = process.getBuiltinModule("node:fs");
		const mainSdk = createFakeMainSdk({ featureId: "todos" });

		const first = mainSdk.storageDir;
		expect(fs.existsSync(first)).toBe(true);
		expect(mainSdk.storageDir).toBe(first);
	});

	it("uses the provided storageDir override", () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos", storageDir: "/tmp/custom-todos" });
		expect(mainSdk.storageDir).toBe("/tmp/custom-todos");
	});

	it("resolvePluginAsset joins subpaths against the provided pluginDir", () => {
		// path.resolve produces platform-specific separators (e.g. backslashes on
		// Windows), so build the expected values the same way rather than
		// hard-coding forward slashes.
		const pluginDir = path.resolve("/tmp/fake-plugin");
		const mainSdk = createFakeMainSdk({ featureId: "todos", pluginDir });
		expect(mainSdk.resolvePluginAsset("drizzle")).toBe(path.resolve(pluginDir, "drizzle"));
		expect(mainSdk.resolvePluginAsset("seeds/en.json")).toBe(
			path.resolve(pluginDir, "seeds/en.json"),
		);
	});

	it("throws on resolvePluginAsset when no pluginDir is provided", () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		expect(() => mainSdk.resolvePluginAsset("drizzle")).toThrow(/no plugin asset directory/);
	});

	it("dispose runs onDispose callbacks in reverse order and clears handlers", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		const order: string[] = [];

		function mainRegister(sdk: MainSdk) {
			sdk.channels(todosChannels).handleAll({
				list: () => [],
				add: ({ title }) => ({ id: "1", title, completed: false }),
			});
			sdk.onDispose(() => order.push("first"));
			sdk.onDispose(() => order.push("second"));
		}

		mainRegister(mainSdk);
		expect(mainSdk.has("list")).toBe(true);

		mainSdk.dispose();

		expect(order).toEqual(["second", "first"]);
		expect(mainSdk.has("list")).toBe(false);
		await expect(mainSdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("provides real events and plugins surfaces", () => {
		const mainSdk = createFakeMainSdk({ featureId: "producer" });
		const listener = vi.fn();
		mainSdk.events.on("producer.changed", listener);
		mainSdk.plugins.expose("service", { read: () => "ok" });

		mainSdk.events.emit("changed", 1);
		expect(listener).toHaveBeenCalledWith(1);
		expect(mainSdk.plugins.get("producer")).toEqual({
			service: { read: expect.any(Function) },
		});
	});
});

describe("createLinkedFakeSdkPair", () => {
	it("links main and renderer events in both directions on one bus", () => {
		const { mainSdk, rendererSdk } = createLinkedFakeSdkPair({ featureId: "producer" });
		const rendererListener = vi.fn();
		const mainListener = vi.fn();
		rendererSdk.events.on("producer.from-main", rendererListener);
		mainSdk.events.on("producer.from-renderer", mainListener);

		mainSdk.events.emit("from-main", { side: "main" });
		rendererSdk.events.emit("from-renderer", { side: "renderer" });

		expect(rendererListener).toHaveBeenCalledWith({ side: "main" });
		expect(mainListener).toHaveBeenCalledWith({ side: "renderer" });
	});

	it("links main and renderer capabilities", () => {
		const { mainSdk, rendererSdk } = createLinkedFakeSdkPair({ featureId: "producer" });
		expect(rendererSdk.plugins.get("producer")).toBeNull();
		mainSdk.plugins.expose("service", { read: () => "ok" });
		expect(rendererSdk.plugins.get("producer")).toEqual({
			service: { read: expect.any(Function) },
		});
	});
});

describe("createFakeSdk", () => {
	it("serves typed invoke through handlers registered on the fake router", async () => {
		const sdk = createFakeSdk({
			featureId: "todos",
			channels: todosChannels,
			handlers: {
				list: () => [{ id: "1", title: "Milk", completed: false }],
			},
		});

		await expect(sdk.invoke("list")).resolves.toEqual([
			{ id: "1", title: "Milk", completed: false },
		]);
	});

	it("works without channels (shell-delegate-only fakes)", () => {
		const sdk = createFakeSdk({ featureId: "shell-only" });
		expect(sdk.featureId).toBe("shell-only");
		expect(sdk.theme.peek()).toBe("light");
		expect(sdk.notifications.show({ type: "info", title: "t", message: "m" }).delivered).toBe(true);
		expect(sdk.notifications.setBadge(1).delivered).toBe(true);
	});

	it("theme.subscribe immediately invokes the listener with light", () => {
		const sdk = createFakeSdk({ featureId: "theme" });
		const listener = vi.fn();
		const unsub = sdk.theme.subscribe(listener);
		expect(listener).toHaveBeenCalledWith("light");
		unsub();
	});

	it("auth delegates report an anonymous session by default", async () => {
		const sdk = createFakeSdk({ featureId: "auth" });
		const listener = vi.fn();
		const unsubscribe = sdk.auth.subscribe(listener);

		expect(listener).toHaveBeenCalledWith({ status: "anonymous" });
		expect(sdk.auth.peek()).toEqual({ status: "anonymous" });
		await expect(sdk.auth.getSession()).resolves.toEqual({ status: "anonymous" });
		await expect(sdk.auth.refresh()).resolves.toEqual({ status: "anonymous" });
		await expect(sdk.auth.login()).resolves.toEqual({ status: "anonymous" });
		await expect(sdk.auth.logout()).resolves.toEqual({ status: "anonymous" });
		expect(() => unsubscribe()).not.toThrow();
	});

	it("shell delegates succeed by default", async () => {
		const sdk = createFakeSdk({ featureId: "shell" });
		await expect(sdk.shell.openExternal("https://example.com")).resolves.toEqual({ opened: true });
		await expect(sdk.shell.copyText("hi")).resolves.toBeUndefined();
	});

	it("fs methods reject with notImplemented until overridden", async () => {
		const sdk = createFakeSdk({ featureId: "fs" });
		await expect(sdk.fs.readFile("x")).rejects.toThrow(/not implemented in test/);
		await expect(sdk.fs.writeFile("x", "y")).rejects.toThrow(/not implemented in test/);
		await expect(sdk.fs.exists("x")).rejects.toThrow(/not implemented in test/);
		await expect(sdk.fs.mkdir("x")).rejects.toThrow(/not implemented in test/);
		await expect(sdk.fs.readdir("x")).rejects.toThrow(/not implemented in test/);
		await expect(sdk.fs.remove("x")).rejects.toThrow(/not implemented in test/);
	});

	it("merges partial shell/fs/notification/theme overrides", async () => {
		const sdk = createFakeSdk({
			featureId: "overrides",
			notifications: { show: () => ({ delivered: false, reason: "blocked" }) },
			theme: { peek: () => "dark" },
			shell: { openExternal: async () => ({ opened: false }) },
			fs: { exists: async () => true },
		});

		expect(sdk.notifications.show({ type: "info", title: "t", message: "m" })).toEqual({
			delivered: false,
			reason: "blocked",
		});
		expect(sdk.theme.peek()).toBe("dark");
		await expect(sdk.shell.openExternal("https://example.com")).resolves.toEqual({ opened: false });
		await expect(sdk.fs.exists("x")).resolves.toBe(true);
	});

	it("ignores undefined override values when merging", () => {
		const sdk = createFakeSdk({
			featureId: "merge-undefined",
			theme: { peek: undefined } as unknown as { peek?: () => "dark" | "light" },
		});
		expect(sdk.theme.peek()).toBe("light");
	});

	it("allows overriding invoke, contribute, commands, events, state, destroy", async () => {
		const customInvoke = vi.fn(async () => "custom");
		const customContribute = vi.fn();
		const customDestroy = vi.fn();
		const sdk = createFakeSdk({
			featureId: "custom",
			invoke: customInvoke,
			contribute: customContribute,
			commands: { register: vi.fn() },
			events: { emit: vi.fn() },
			state: { peek: () => 42 },
			destroy: customDestroy,
			onDispose: vi.fn(),
		});

		await expect(sdk.invoke("anything")).resolves.toBe("custom");
		expect(customInvoke).toHaveBeenCalled();
		sdk.contribute("zone", { component: "X", label: "Label" });
		expect(customContribute).toHaveBeenCalled();
		expect(sdk.state.peek("x")).toBe(42);
		sdk.destroy();
		expect(customDestroy).toHaveBeenCalled();
	});

	it("registers only provided handlers when channels are given", async () => {
		const sdk = createFakeSdk({
			featureId: "partial",
			channels: todosChannels,
			handlers: {
				list: () => [],
				// add intentionally omitted
			},
		});
		await expect(sdk.invoke("list")).resolves.toEqual([]);
		await expect(sdk.invoke("add", { title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("accepts channels without handlers (no router registration)", async () => {
		const sdk = createFakeSdk({
			featureId: "channels-only",
			channels: todosChannels,
		});
		await expect(sdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("exposes backing services for assertions", () => {
		const sdk = createFakeSdk({ featureId: "services" });
		expect(sdk.services.eventBus).toBeDefined();
		expect(sdk.services.stateBroker).toBeDefined();
		expect(sdk.services.featureRouter).toBeDefined();
	});
});

describe("createFakeFeatureSystem", () => {
	it("returns registered sdks and creates unknown ids on shared services", () => {
		const producer = createFakeSdk({ featureId: "sdk-producer" });
		const system = createFakeFeatureSystem({ sdks: { "sdk-producer": producer } });

		expect(system.getSdk("sdk-producer")).toBe(producer);
		expect(system.services).toBe(producer.services);

		const other = system.getSdk("other");
		expect(other.featureId).toBe("other");
		expect(system.getSdk("other")).toBe(other);
	});

	it("teardownFeature destroys and drops only the named sdk", () => {
		const producer = createFakeSdk({ featureId: "sdk-producer" });
		const destroy = vi.fn();
		producer.destroy = destroy;
		const system = createFakeFeatureSystem({ sdks: { "sdk-producer": producer } });

		system.teardownFeature("missing");
		expect(destroy).not.toHaveBeenCalled();

		system.teardownFeature("sdk-producer");
		expect(destroy).toHaveBeenCalledOnce();
		expect(system.getSdk("sdk-producer")).not.toBe(producer);
	});

	it("requires services when no FakeSdk is provided", () => {
		expect(() => createFakeFeatureSystem({ sdks: {} })).toThrow(/requires `services`/);
	});
});
