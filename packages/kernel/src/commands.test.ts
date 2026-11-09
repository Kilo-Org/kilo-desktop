import { describe, expect, it, vi } from "vitest";

import { KernelCommand, KernelKeybindings } from "./builtins";
import { resolveKeybindings } from "./commands";
import { createMainKernel } from "./main/main-kernel";
import type { PluginSdk } from "./sdk";
import { testPlugin } from "./test-fixtures";
import { createLinkedTransports } from "./transport";
import { createRendererKernel } from "./web/renderer-kernel";

const host = () => ({
	platform: "mac" as const,
	version: "1.0.0",
	confirm: async () => true,
	quit: () => {},
	relaunch: () => {},
});

function commandPlugin(
	id: string,
	commands: Record<string, unknown>[],
	activate: (sdk: PluginSdk) => void = () => {},
	manifest: Record<string, unknown> = {},
) {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { "kernel/command": commands } }, ...manifest },
		entry: { activate },
	});
}

async function bootPair(options: {
	main?: (sdk: PluginSdk) => void;
	renderer?: (sdk: PluginSdk) => void;
	commands: Record<string, unknown>[];
	manifest?: Record<string, unknown>;
}) {
	const transports = createLinkedTransports();
	const main = createMainKernel({
		host: host(),
		transport: transports.main,
		registrations: [commandPlugin("acme.cmd", options.commands, options.main, options.manifest)],
	});
	await main.start();
	const renderer = createRendererKernel({
		windowId: "w1",
		transport: transports.connectRenderer("w1"),
		platform: "mac",
		registrations: [
			commandPlugin("acme.cmd", options.commands, options.renderer, options.manifest),
		],
	});
	await renderer.activate();
	await main.flush();
	return { main, renderer };
}

describe("commands", () => {
	it("lists implemented commands with their metadata defaults", async () => {
		const { renderer } = await bootPair({
			commands: [
				{ id: "save", title: "Save" },
				{ id: "unbound", title: "Never implemented" },
			],
			renderer: (sdk) => sdk.extensions.implement(KernelCommand, "save", () => "saved"),
		});

		expect(renderer.commands.list().map((command) => [command.key, command.metadata])).toEqual([
			["acme.cmd/save", { title: "Save", palette: true, repeatable: false, handledLocally: false }],
		]);
		await expect(renderer.commands.execute("acme.cmd/save")).resolves.toBe("saved");
	});

	it("runs a command implemented in main when executed from a renderer", async () => {
		const handler = vi.fn((args?: unknown) => ({ echoed: args }));
		const { renderer } = await bootPair({
			commands: [{ id: "push", title: "Push" }],
			main: (sdk) => sdk.extensions.implement(KernelCommand, "push", handler),
		});

		await expect(renderer.commands.execute("acme.cmd/push", { force: true })).resolves.toEqual({
			echoed: { force: true },
		});
	});

	it("delivers a main-side execution to the window that implements the command", async () => {
		const handler = vi.fn();
		const { main, renderer } = await bootPair({
			commands: [{ id: "focus", title: "Focus composer" }],
			renderer: (sdk) => sdk.extensions.implement(KernelCommand, "focus", handler),
		});

		await main.commands.execute("acme.cmd/focus");
		await renderer.flush();

		expect(handler).toHaveBeenCalledOnce();
	});

	it("runs a command in a given window, judged by that window's conditions", async () => {
		const handler = vi.fn();
		const { main, renderer } = await bootPair({
			commands: [{ id: "close-tab", title: "Close tab", when: { all: ["acme.cmd/tabOpen"] } }],
			manifest: { contextKeys: [{ id: "tabOpen", scope: "window" }] },
			renderer: (sdk) => {
				sdk.context.set("tabOpen", true);
				sdk.extensions.implement(KernelCommand, "close-tab", handler);
			},
		});

		main.commands.executeInWindow("w1", "acme.cmd/close-tab");
		await renderer.flush();

		expect(handler).toHaveBeenCalledOnce();
	});

	it("runs a command from a window that only another window implements", async () => {
		const handler = vi.fn();
		const commands = [{ id: "open", title: "Open" }];
		const transports = createLinkedTransports();
		const main = createMainKernel({
			host: host(),
			transport: transports.main,
			registrations: [commandPlugin("acme.cmd", commands)],
		});
		await main.start();
		const window = (windowId: string, activate: (sdk: PluginSdk) => void = () => {}) =>
			createRendererKernel({
				windowId,
				transport: transports.connectRenderer(windowId),
				platform: "mac",
				registrations: [commandPlugin("acme.cmd", commands, activate)],
			});
		const first = window("w1", (sdk) => sdk.extensions.implement(KernelCommand, "open", handler));
		await first.activate();
		const second = window("w2");
		await second.activate();
		await main.flush();

		await second.commands.execute("acme.cmd/open", { id: "s1" });
		await first.flush();

		expect(handler).toHaveBeenCalledWith({ id: "s1" });
	});

	describe("with two windows", () => {
		async function bootWindows() {
			const commands = [{ id: "focus", title: "Focus composer" }];
			const transports = createLinkedTransports();
			const main = createMainKernel({
				host: host(),
				transport: transports.main,
				registrations: [commandPlugin("acme.cmd", commands)],
			});
			await main.start();
			const handlers = { w1: vi.fn(), w2: vi.fn() };
			const open = async (windowId: "w1" | "w2", implement = true) => {
				const window = createRendererKernel({
					windowId,
					transport: transports.connectRenderer(windowId),
					platform: "mac",
					registrations: [
						commandPlugin("acme.cmd", commands, (sdk) => {
							if (implement) sdk.extensions.implement(KernelCommand, "focus", handlers[windowId]);
						}),
					],
				});
				await window.activate();
				await main.flush();
				return window;
			};
			await open("w1");
			main.windowEvents.opened("w1", { role: "main" });
			await open("w2");
			main.windowEvents.opened("w2", { role: "secondary" });
			const run = async () => {
				await main.commands.execute("acme.cmd/focus");
				await main.flush();
			};
			return { main, handlers, open, run };
		}

		it("runs a main-side execution in the focused window", async () => {
			const { main, handlers, run } = await bootWindows();

			main.windowEvents.focused("w2");
			await run();

			expect(handlers.w2).toHaveBeenCalledOnce();
			expect(handlers.w1).not.toHaveBeenCalled();
		});

		it("forgets a closed window's commands and runs them in a window still open", async () => {
			const { main, handlers, run } = await bootWindows();

			main.windowEvents.closed("w1");
			await run();

			expect(handlers.w2).toHaveBeenCalledOnce();
			expect(handlers.w1).not.toHaveBeenCalled();
		});

		it("forgets a reloaded window's commands until it implements them again", async () => {
			const { handlers, open, run } = await bootWindows();

			await open("w1", false);
			await run();

			expect(handlers.w2).toHaveBeenCalledOnce();
			expect(handlers.w1).not.toHaveBeenCalled();
		});
	});

	it("rejects unknown commands", async () => {
		const { renderer } = await bootPair({ commands: [] });

		await expect(renderer.commands.execute("acme.cmd/nope")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("resolveKeybindings", () => {
	const command = (key: string, keybinding?: string | string[], scoped = false) => ({
		key,
		scoped,
		metadata: { title: key, ...(keybinding === undefined ? {} : { keybinding }) },
	});

	it("resolves defaults for the platform, including several shortcuts for one command", () => {
		const result = resolveKeybindings({
			commands: [command("a/save", "Mod+S"), command("a/find", ["Mod+F", "F3"])],
			overrides: {},
			platform: "mac",
		});

		expect(result.byCommand).toEqual({ "a/save": ["Meta+KeyS"], "a/find": ["Meta+KeyF", "F3"] });
		expect(result.bindings).toEqual({
			"Meta+KeyS": ["a/save"],
			"Meta+KeyF": ["a/find"],
			F3: ["a/find"],
		});
	});

	it("gives a contested default to the first command and reports the others", () => {
		const result = resolveKeybindings({
			commands: [command("a/one", "Mod+K"), command("b/two", "Mod+K")],
			overrides: {},
			platform: "linux",
		});

		expect(result.byCommand).toEqual({ "a/one": ["Ctrl+KeyK"], "b/two": [] });
		expect(result.conflicts).toEqual([{ chord: "Ctrl+KeyK", commands: ["a/one", "b/two"] }]);
	});

	it("lets overrides claim first, unbind, and take a chord from a default", () => {
		const result = resolveKeybindings({
			commands: [command("a/one", "Mod+K"), command("b/two", "Mod+J"), command("c/three", "Mod+L")],
			overrides: { "b/two": "Ctrl+KeyK", "c/three": null },
			platform: "linux",
		});

		expect(result.byCommand).toEqual({ "a/one": [], "b/two": ["Ctrl+KeyK"], "c/three": [] });
		expect(result.bindings).toEqual({ "Ctrl+KeyK": ["b/two"] });
	});

	it("lists commands handled locally without binding or contesting their chords", () => {
		const result = resolveKeybindings({
			commands: [
				{ key: "c/send", scoped: false, metadata: { keybinding: "Enter", handledLocally: true } },
				command("a/confirm", "Enter"),
			],
			overrides: {},
			platform: "mac",
		});

		expect(result.byCommand).toEqual({ "c/send": ["Enter"], "a/confirm": ["Enter"] });
		expect(result.bindings).toEqual({ Enter: ["a/confirm"] });
		expect(result.conflicts).toEqual([]);
	});

	it("binds conditional commands alongside the owner without contesting the chord", () => {
		const result = resolveKeybindings({
			commands: [command("a/clear", "Mod+K", true), command("b/search", "Mod+K")],
			overrides: {},
			platform: "linux",
		});

		expect(result.byCommand).toEqual({ "a/clear": ["Ctrl+KeyK"], "b/search": ["Ctrl+KeyK"] });
		expect(result.bindings).toEqual({ "Ctrl+KeyK": ["b/search", "a/clear"] });
		expect(result.conflicts).toEqual([]);
	});
});

describe("keyboard dispatch", () => {
	it("runs the command bound to a chord when its condition holds", async () => {
		const handler = vi.fn();
		const { renderer } = await bootPair({
			commands: [
				{ id: "clear", title: "Clear", keybinding: "Mod+K", when: { all: ["acme.cmd/focused"] } },
			],
			manifest: { contextKeys: [{ id: "focused", scope: "window" }] },
			renderer: (sdk) => sdk.extensions.implement(KernelCommand, "clear", handler),
		});
		expect(renderer.keyboard.chords()).toEqual(["Meta+KeyK"]);
		await expect(renderer.keyboard.dispatch("Meta+KeyK")).resolves.toBe(false);

		renderer.sdkFor("acme.cmd").context.set("focused", true);

		await expect(renderer.keyboard.dispatch("Meta+KeyK")).resolves.toBe(true);
		await expect(renderer.keyboard.dispatch("Meta+KeyJ")).resolves.toBe(false);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("follows user overrides stored in main", async () => {
		const handler = vi.fn();
		const { main, renderer } = await bootPair({
			commands: [{ id: "save", title: "Save", keybinding: "Mod+S" }],
			renderer: (sdk) => sdk.extensions.implement(KernelCommand, "save", handler),
		});

		await renderer.kernelSdk.domains
			.get(KernelKeybindings)!
			.methods.setOverride({ command: "acme.cmd/save", chord: "Alt+KeyS" });
		await main.flush();

		expect(renderer.keyboard.chords()).toEqual(["Alt+KeyS"]);
	});
});

describe("keyboard dispatch — conditional precedence", () => {
	it("runs the conditional command while its condition holds, otherwise the owner", async () => {
		const clear = vi.fn();
		const search = vi.fn();
		const { renderer } = await bootPair({
			commands: [
				{ id: "search", title: "Search", keybinding: "Mod+K" },
				{ id: "clear", title: "Clear", keybinding: "Mod+K", when: { all: ["acme.cmd/focused"] } },
			],
			manifest: { contextKeys: [{ id: "focused", scope: "window" }] },
			renderer: (sdk) => {
				sdk.extensions.implement(KernelCommand, "search", search);
				sdk.extensions.implement(KernelCommand, "clear", clear);
			},
		});

		await renderer.keyboard.dispatch("Meta+KeyK");
		renderer.sdkFor("acme.cmd").context.set("focused", true);
		await renderer.keyboard.dispatch("Meta+KeyK");

		expect(search).toHaveBeenCalledOnce();
		expect(clear).toHaveBeenCalledOnce();
	});

	it("runs the last contributed of several conditional commands whose conditions hold", async () => {
		const clear = vi.fn();
		const search = vi.fn();
		const { renderer } = await bootPair({
			commands: [
				{ id: "search", title: "Search", keybinding: "Mod+K", when: { none: ["acme.cmd/popup"] } },
				{ id: "clear", title: "Clear", keybinding: "Mod+K", when: { all: ["acme.cmd/focused"] } },
			],
			manifest: {
				contextKeys: [
					{ id: "focused", scope: "window" },
					{ id: "popup", scope: "window" },
				],
			},
			renderer: (sdk) => {
				sdk.extensions.implement(KernelCommand, "search", search);
				sdk.extensions.implement(KernelCommand, "clear", clear);
			},
		});

		await renderer.keyboard.dispatch("Meta+KeyK");
		renderer.sdkFor("acme.cmd").context.set("focused", true);
		await renderer.keyboard.dispatch("Meta+KeyK");

		expect(search).toHaveBeenCalledOnce();
		expect(clear).toHaveBeenCalledOnce();
	});
});

describe("keyboard recording", () => {
	it("pauses every binding while a new shortcut is being recorded", async () => {
		const handler = vi.fn();
		const { renderer } = await bootPair({
			commands: [{ id: "save", title: "Save", keybinding: "Mod+S" }],
			renderer: (sdk) => sdk.extensions.implement(KernelCommand, "save", handler),
		});
		const changes = vi.fn();
		renderer.keyboard.subscribe(changes);

		renderer.keyboard.setRecording(true);

		expect(renderer.keyboard.chords()).toEqual([]);
		await expect(renderer.keyboard.dispatch("Meta+KeyS")).resolves.toBe(false);
		expect(changes).toHaveBeenCalled();
		renderer.keyboard.setRecording(false);
		expect(renderer.keyboard.chords()).toEqual(["Meta+KeyS"]);
	});
});
