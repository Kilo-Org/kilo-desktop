import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeMainSdkProtocol,
	createFakeSdk,
	createFakeTheme,
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

describe("createFakeMainSdkProtocol", () => {
	it("records handlers by scheme and lets a later handle call replace one", async () => {
		const protocol = createFakeMainSdkProtocol();
		expect(protocol.handler).toBeUndefined();
		expect(protocol.handlers.size).toBe(0);

		const first = () => new Response("one");
		protocol.handle("kilo-git", first);
		expect(protocol.handler).toBe(first);
		expect(protocol.handlers.get("kilo-git")).toBe(first);

		const second = async () => new Response("two");
		protocol.handle("kilo-git", second);
		expect(protocol.handler).toBe(second);
		expect(await protocol.handler?.(new Request("kilo-git://diff/patch"))).toEqual(
			new Response("two"),
		);
	});
});

describe("createFakeMainSdk", () => {
	it("passes a protocol delegate through so features can install handlers", () => {
		const protocol = createFakeMainSdkProtocol();
		const mainSdk = createFakeMainSdk({ featureId: "git", protocol });

		mainSdk.protocol?.handle("kilo-git", () => new Response("diff"));

		expect(protocol.handler).toBeTypeOf("function");
		expect(mainSdk.protocol).toBe(protocol);
	});

	it("leaves protocol undefined when no delegate is provided", () => {
		const mainSdk = createFakeMainSdk({ featureId: "git" });
		expect(mainSdk.protocol).toBeUndefined();
	});

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

	it("uses injected logger and network delegates", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const fetch = vi.fn(async () => Response.json({ ok: true })) as typeof globalThis.fetch;
		const mainSdk = createFakeMainSdk({ featureId: "todos", logger, fetch });

		expect(mainSdk.logger).toBe(logger);
		mainSdk.logger.info("ready", { id: "1" });
		expect(logger.info).toHaveBeenCalledWith("ready", { id: "1" });
		await expect(mainSdk.net.fetch("https://example.test")).resolves.toBeInstanceOf(Response);
		expect(fetch).toHaveBeenCalledWith("https://example.test");
	});

	it("boot.reportProgress forwards to the injected reporter", () => {
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({ featureId: "todos", reportBootProgress });

		mainSdk.boot.reportProgress("Staging…");

		expect(reportBootProgress).toHaveBeenCalledWith("Staging…");
	});

	it("boot.reportProgress defaults to a silent no-op", () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		expect(() => mainSdk.boot.reportProgress("nobody listens")).not.toThrow();
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

	it("disposeAsync awaits onDispose callbacks in reverse order and clears handlers", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		const order: string[] = [];

		function mainRegister(sdk: MainSdk) {
			sdk.channels(todosChannels).handleAll({
				list: () => [],
				add: ({ title }) => ({ id: "1", title, completed: false }),
			});
			sdk.onDispose(async () => {
				await Promise.resolve();
				order.push("first");
			});
			sdk.onDispose(async () => {
				await Promise.resolve();
				order.push("second");
			});
		}

		mainRegister(mainSdk);
		expect(mainSdk.has("list")).toBe(true);

		await mainSdk.disposeAsync();

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

	it("works without channels (shell-delegate-only fakes)", async () => {
		const sdk = createFakeSdk({ featureId: "shell-only" });
		expect(sdk.featureId).toBe("shell-only");
		await expect(
			sdk.notifications.show({ type: "info", title: "t", message: "m" }),
		).resolves.toEqual({ delivered: true });
		await expect(sdk.notifications.setBadge(1)).resolves.toEqual({ delivered: true });
		await expect(sdk.telemetry.track({ event: "test" })).resolves.toBeUndefined();
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
		await expect(sdk.shell.showOpenDialog({ kind: "directory", multiple: true })).resolves.toEqual({
			canceled: true,
			paths: [],
		});
		const pane = {
			pluginId: "kilo-ui",
			sessionId: "session-1",
			paneId: "pane-1",
			title: "Pane",
			path: "/plugins/chat",
		};
		await expect(sdk.shell.openPaneWindow(pane)).resolves.toEqual({ opened: true });
		await expect(sdk.shell.listPaneWindows("kilo-ui")).resolves.toEqual([]);
		await expect(sdk.shell.focusPaneWindow(pane)).resolves.toEqual({ focused: true });
		await expect(sdk.shell.dockPaneWindow(pane)).resolves.toEqual({ docked: true });
		await expect(sdk.shell.syncPaneWindows("kilo-ui", "session-1")).resolves.toBeUndefined();
		const unsubscribe = sdk.shell.onPaneWindowChanged(vi.fn());
		expect(() => unsubscribe()).not.toThrow();
	});

	it("fs is an in-memory sandbox: write, read, list, remove", async () => {
		const sdk = createFakeSdk({ featureId: "fs" });
		await expect(sdk.fs.exists("notes/a.txt")).resolves.toBe(false);
		await sdk.fs.writeFile("notes/a.txt", "hello");
		await expect(sdk.fs.readFile("notes/a.txt")).resolves.toBe("hello");
		await expect(sdk.fs.exists("notes")).resolves.toBe(true);
		await sdk.fs.mkdir("notes/archive");
		await expect(sdk.fs.readdir("notes")).resolves.toEqual(["a.txt", "archive"]);
		await expect(sdk.fs.readdir("")).resolves.toEqual(["notes"]);
		await sdk.fs.remove("notes");
		await expect(sdk.fs.exists("notes")).resolves.toBe(false);
		await expect(sdk.fs.readFile("notes/a.txt")).rejects.toThrow(/no such file/);
		await expect(sdk.fs.readdir("notes")).rejects.toThrow(/no such file/);
	});

	it("fs sandboxes are scoped per feature and reject escaping paths", async () => {
		const a = createFakeSdk({ featureId: "feature-a" });
		const b = createFakeSdk({ featureId: "feature-b" });
		await a.fs.writeFile("shared.txt", "from a");
		await expect(b.fs.exists("shared.txt")).resolves.toBe(false);

		await expect(a.fs.readFile("/etc/passwd")).rejects.toThrow(/must be relative/);
		await expect(a.fs.readFile("../feature-b/shared.txt")).rejects.toThrow(/cannot escape/);
		// Dot segments that stay inside the sandbox are fine.
		await expect(a.fs.readFile("./nested/../shared.txt")).resolves.toBe("from a");
	});

	it("fs remove('') clears the sandbox but keeps the root readable", async () => {
		const sdk = createFakeSdk({ featureId: "fs-root" });
		await sdk.fs.writeFile("a/b.txt", "x");
		await sdk.fs.mkdir("c");
		await sdk.fs.remove("");
		await expect(sdk.fs.readdir("")).resolves.toEqual([]);
		await expect(sdk.fs.exists("a")).resolves.toBe(false);
		await expect(sdk.fs.exists("")).resolves.toBe(true);
	});

	it("fs rejects file/dir key collisions like a real filesystem", async () => {
		const sdk = createFakeSdk({ featureId: "fs-collision" });
		await sdk.fs.writeFile("a.txt", "x");
		// A directory cannot shadow an existing file, and vice versa.
		await expect(sdk.fs.mkdir("a.txt")).rejects.toThrow(/not a directory/);
		await expect(sdk.fs.writeFile("a.txt/child", "y")).rejects.toThrow(/not a directory/);
		await sdk.fs.mkdir("dir");
		await expect(sdk.fs.writeFile("dir", "z")).rejects.toThrow(/is a directory/);
	});

	it("routes every overridden fs method and falls back per method", async () => {
		const calls: string[] = [];
		const overridden = createFakeSdk({
			featureId: "fs-all-overrides",
			fs: {
				readFile: async (p) => {
					calls.push(`readFile:${p}`);
					return "o";
				},
				writeFile: async (p) => {
					calls.push(`writeFile:${p}`);
				},
				exists: async (p) => {
					calls.push(`exists:${p}`);
					return true;
				},
				mkdir: async (p) => {
					calls.push(`mkdir:${p}`);
				},
				readdir: async (p) => {
					calls.push(`readdir:${p}`);
					return ["o.txt"];
				},
				remove: async (p) => {
					calls.push(`remove:${p}`);
				},
			},
		});
		await expect(overridden.fs.readFile("f")).resolves.toBe("o");
		await overridden.fs.writeFile("f", "x");
		await expect(overridden.fs.exists("f")).resolves.toBe(true);
		await overridden.fs.mkdir("d");
		await expect(overridden.fs.readdir("d")).resolves.toEqual(["o.txt"]);
		await overridden.fs.remove("f");
		expect(calls).toEqual([
			"readFile:f",
			"writeFile:f",
			"exists:f",
			"mkdir:d",
			"readdir:d",
			"remove:f",
		]);

		// A partial override leaves the other methods on the in-memory sandbox.
		const partial = createFakeSdk({
			featureId: "fs-partial",
			fs: { readFile: async () => "overridden" },
		});
		await partial.fs.writeFile("kept.txt", "v");
		await expect(partial.fs.exists("kept.txt")).resolves.toBe(true);
		await partial.fs.mkdir("dir");
		await expect(partial.fs.readdir("")).resolves.toEqual(["dir", "kept.txt"]);
		await partial.fs.remove("kept.txt");
		await expect(partial.fs.exists("kept.txt")).resolves.toBe(false);
		await expect(partial.fs.readFile("anything")).resolves.toBe("overridden");
	});

	it("notifies SDK subscribers of same-mode appearance changes with stable snapshots", () => {
		const theme = createFakeTheme();
		const sdk = createFakeSdk({ featureId: "appearance", theme });
		const initial = sdk.theme.appearance();
		expect(initial).toEqual({
			mode: "light",
			themeId: "anaconda",
			terminal: null,
			shiki: "pierre-light",
		});
		expect(sdk.theme.appearance()).toBe(initial);
		const listener = vi.fn();
		const unsubscribe = sdk.theme.subscribe(listener);
		expect(listener).toHaveBeenCalledOnce();
		const next = { ...initial, themeId: "kilo", shiki: "github-light" };
		theme.setAppearance(next);
		expect(sdk.theme.appearance()).toBe(next);
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
		theme.setAppearance(initial);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("navigation defaults report the home location", () => {
		const sdk = createFakeSdk({ featureId: "nav" });
		expect(sdk.location.peek()).toEqual({ path: "/", search: {} });
		const seen: unknown[] = [];
		const unsub = sdk.location.subscribe((location) => seen.push(location));
		expect(seen).toEqual([{ path: "/", search: {} }]);
		expect(() => unsub()).not.toThrow();
		expect(() => sdk.navigate("/anywhere")).not.toThrow();
	});

	it("merges partial shell/fs/notification/theme overrides", async () => {
		const darkAppearance = {
			mode: "dark",
			themeId: "anaconda",
			terminal: null,
			shiki: "pierre-dark",
		} as const;
		const sdk = createFakeSdk({
			featureId: "overrides",
			notifications: { show: async () => ({ delivered: false, reason: "blocked" }) },
			theme: { appearance: () => darkAppearance },
			shell: { openExternal: async () => ({ opened: false }) },
			fs: { exists: async () => true },
		});

		await expect(
			sdk.notifications.show({ type: "info", title: "t", message: "m" }),
		).resolves.toEqual({
			delivered: false,
			reason: "blocked",
		});
		expect(sdk.theme.appearance()).toBe(darkAppearance);
		await expect(sdk.shell.openExternal("https://example.com")).resolves.toEqual({ opened: false });
		// Overridden method wins; the rest falls back to the in-memory sandbox.
		await expect(sdk.fs.exists("x")).resolves.toBe(true);
		await sdk.fs.writeFile("x.txt", "kept");
		await expect(sdk.fs.readFile("x.txt")).resolves.toBe("kept");
	});

	it("ignores undefined override values when merging", () => {
		const sdk = createFakeSdk({
			featureId: "merge-undefined",
			theme: { appearance: undefined } as unknown as { appearance?: () => never },
		});
		expect(sdk.theme.appearance().mode).toBe("light");
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
		sdk.contribute("zone", { id: "label", component: "X", label: "Label" });
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
		expect(sdk.services.featureRouter.eventBus).toBeDefined();
		expect(sdk.services.stateBroker).toBeDefined();
		expect(sdk.services.featureRouter).toBeDefined();
	});
});

describe("createFakeFeatureSystem", () => {
	it("returns registered sdks and creates unknown ids on shared services", () => {
		const notes = createFakeSdk({ featureId: "notes" });
		const system = createFakeFeatureSystem({ sdks: { notes } });

		expect(system.getSdk("notes")).toBe(notes);
		expect(system.services).toBe(notes.services);

		const other = system.getSdk("other");
		expect(other.featureId).toBe("other");
		expect(system.getSdk("other")).toBe(other);
	});

	it("teardownFeature destroys and drops only the named sdk", () => {
		const notes = createFakeSdk({ featureId: "notes" });
		const destroy = vi.fn();
		notes.destroy = destroy;
		const system = createFakeFeatureSystem({ sdks: { notes } });

		system.teardownFeature("missing");
		expect(destroy).not.toHaveBeenCalled();

		system.teardownFeature("notes");
		expect(destroy).toHaveBeenCalledOnce();
		expect(system.getSdk("notes")).not.toBe(notes);
	});

	it("requires services when no FakeSdk is provided", () => {
		expect(() => createFakeFeatureSystem({ sdks: {} })).toThrow(/requires `services`/);
	});

	it("disposes every cached SDK exactly once", () => {
		const notes = createFakeSdk({ featureId: "notes" });
		const destroy = vi.spyOn(notes, "destroy");
		const system = createFakeFeatureSystem({ sdks: { notes } });
		system.getSdk("consumer");

		system.dispose();
		system.dispose();

		expect(destroy).toHaveBeenCalledOnce();
		expect(() => system.getSdk("notes")).toThrow(/disposed/);
	});
});
