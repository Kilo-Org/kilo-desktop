import { afterEach, describe, expect, it, vi } from "vitest";

import { z } from "zod";

import {
	KernelApp,
	KernelCommand,
	KernelDomainObjects,
	KernelExtensions,
	KernelKeybindings,
	KernelKeychain,
	KernelPlugins,
	KernelQuit,
	KernelSystem,
	KernelWindowClose,
	KernelWindows,
	type AppPhase,
} from "../builtins";
import { defineDomainObject } from "../domain-object";
import type { DecisionAnswer } from "../extension-point";
import type { PluginEntry, PluginRegistration } from "../plugin";
import { testPlugin } from "../test-fixtures";
import { createTestKernelPair } from "../testing";
import { createMainKernel, type MainKernelHost } from "./main-kernel";

function fakeHost(overrides: Partial<MainKernelHost> = {}): MainKernelHost {
	return {
		platform: "mac",
		version: "1.2.3",
		confirm: vi.fn(async () => true),
		quit: vi.fn(),
		relaunch: vi.fn(),
		...overrides,
	};
}

function decider(
	id: string,
	point: typeof KernelQuit | typeof KernelWindowClose,
	answer: () => DecisionAnswer,
) {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { [point.id]: [{ id: "check" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(point as typeof KernelQuit, "check", answer);
			},
		},
	});
}

function boot(registrations: PluginRegistration[], host = fakeHost(), options = {}) {
	return createMainKernel({ registrations, host, ...options });
}

afterEach(() => {
	vi.useRealTimers();
});

describe("main kernel — application lifecycle", () => {
	it("moves through starting, started and ready, announcing each phase", async () => {
		const kernel = boot([]);
		const phases: AppPhase[] = [];
		kernel.kernelSdk.domainObjects
			.get(KernelApp)!
			.on("phase-changed", ({ phase }) => void phases.push(phase));

		await kernel.start();
		expect(kernel.kernelSdk.domainObjects.get(KernelApp)!.getState()).toMatchObject({
			phase: "starting",
			platform: "mac",
			version: "1.2.3",
			safeMode: false,
		});
		await kernel.windowShown();
		await kernel.stop();

		expect(phases).toEqual(["started", "ready", "stopping", "stopped"]);
	});

	it("publishes the origins the app's windows load from", async () => {
		const kernel = boot([], fakeHost({ rendererOrigins: ["kilo-desktop://app"] }));
		const noOrigins = boot([]);

		expect(kernel.kernelSdk.domainObjects.get(KernelApp)!.getState().rendererOrigins).toEqual([
			"kilo-desktop://app",
		]);
		expect(noOrigins.kernelSdk.domainObjects.get(KernelApp)!.getState().rendererOrigins).toEqual(
			[],
		);
	});

	it("publishes plugin states and issues through kernel/plugins", async () => {
		const kernel = boot([
			testPlugin("acme.ok", { entry: { activate: () => {} } }),
			testPlugin("acme.bad", {
				entry: {
					activate: () => {
						throw new Error("boom");
					},
				},
			}),
		]);

		await kernel.start();

		const plugins = kernel.kernelSdk.domainObjects.get(KernelPlugins)!.getState();
		expect(plugins.plugins["acme.ok"]).toMatchObject({ state: "active", displayName: "acme.ok" });
		expect(plugins.plugins["acme.bad"]?.state).toBe("failed");
		expect(plugins.issues).toContainEqual(expect.objectContaining({ pluginId: "acme.bad" }));
	});

	it("sets platform context keys and boots no plugins in safe mode", async () => {
		const activate = vi.fn();
		const kernel = boot(
			[testPlugin("acme.any", { entry: { activate } })],
			fakeHost({ platform: "windows", safeMode: true }),
		);

		await kernel.start();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.contextKeys.get("kernel/windows")).toBe(true);
		expect(kernel.contextKeys.get("kernel/mac")).toBe(false);
		expect(kernel.contextKeys.get("kernel/safeMode")).toBe(true);
	});

	it("routes kernel/app quit and relaunch to the host", async () => {
		const host = fakeHost();
		const kernel = boot([], host);
		await kernel.start();
		const app = kernel.kernelSdk.domainObjects.get(KernelApp)!;

		await app.methods.quit(undefined);
		await app.methods.relaunch({ safeMode: true });

		expect(host.quit).toHaveBeenCalled();
		expect(host.relaunch).toHaveBeenCalledWith({ safeMode: true });
	});
});

describe("main kernel — quit and window-close decisions", () => {
	it("quits without asking when nobody objects", async () => {
		const host = fakeHost();
		const kernel = boot([decider("acme.a", KernelQuit, () => "proceed")], host);
		await kernel.start();

		await expect(kernel.requestQuit()).resolves.toBe(true);
		expect(host.confirm).not.toHaveBeenCalled();
	});

	it("asks once with every reason and respects the answer", async () => {
		const host = fakeHost({ confirm: vi.fn(async () => false) });
		const kernel = boot(
			[
				decider("acme.a", KernelQuit, () => ({ ask: "Unsaved notebook." })),
				decider("acme.b", KernelQuit, () => ({ ask: "Terminal running." })),
			],
			host,
		);
		await kernel.start();

		await expect(kernel.requestQuit()).resolves.toBe(false);
		expect(host.confirm).toHaveBeenCalledWith("quit", ["Unsaved notebook.", "Terminal running."]);
	});

	it("always quits on a second request after a prompt, so the user can never be trapped", async () => {
		const host = fakeHost({ confirm: vi.fn(async () => false) });
		const kernel = boot([decider("acme.a", KernelQuit, () => ({ reject: "Busy." }))], host);
		await kernel.start();

		await expect(kernel.requestQuit()).resolves.toBe(false);
		await expect(kernel.requestQuit()).resolves.toBe(true);
	});

	it("asks the window-close decision for the closing window", async () => {
		const answer = vi.fn((): DecisionAnswer => ({ ask: "Unsaved." }));
		const host = fakeHost({ confirm: vi.fn(async () => true) });
		const kernel = boot([decider("acme.a", KernelWindowClose, answer)], host);
		await kernel.start();

		await expect(kernel.requestWindowClose("w2")).resolves.toBe(true);
		expect(host.confirm).toHaveBeenCalledWith("window-close", ["Unsaved."]);
	});
});

describe("main kernel — stopping", () => {
	it("deactivates plugins in reverse order", async () => {
		const order: string[] = [];
		const entry = (id: string): PluginEntry => ({
			activate: () => {},
			deactivate: () => void order.push(id),
		});
		const kernel = boot([
			testPlugin("acme.first", { entry: entry("first") }),
			testPlugin("acme.second", { entry: entry("second") }),
		]);
		await kernel.start();

		await kernel.stop();

		expect(order).toEqual(["second", "first"]);
	});

	it("never takes longer than the stop cap, even if a plugin hangs", async () => {
		vi.useFakeTimers();
		const kernel = boot(
			[
				testPlugin("acme.hang", {
					entry: { activate: () => {}, deactivate: () => new Promise(() => {}) },
				}),
			],
			fakeHost(),
			{ stopCapMs: 1_000 },
		);
		await kernel.start();

		const stopping = kernel.stop();
		await vi.advanceTimersByTimeAsync(1_000);

		await expect(stopping).resolves.toBeUndefined();
		expect(kernel.kernelSdk.domainObjects.get(KernelApp)!.getState().phase).toBe("stopped");
	});
});

describe("main kernel — window and system hooks", () => {
	it("tracks windows and announces their events", async () => {
		const kernel = boot([]);
		await kernel.start();
		const windows = kernel.kernelSdk.domainObjects.get(KernelWindows)!;
		const events: string[] = [];
		windows.on("opened", ({ windowId }) => void events.push(`opened:${windowId}`));
		windows.on("focused", ({ windowId }) => void events.push(`focused:${windowId}`));
		windows.on("closed", ({ windowId }) => void events.push(`closed:${windowId}`));

		kernel.windowEvents.opened("main", { role: "main" });
		kernel.windowEvents.focused("main");
		expect(windows.getState().windows.main).toEqual({
			role: "main",
			params: {},
			focused: true,
			hidden: false,
		});
		kernel.windowEvents.closed("main");

		expect(events).toEqual(["opened:main", "focused:main", "closed:main"]);
		expect(windows.getState().windows).toEqual({});
	});

	it("updates system state and emits the matching events", async () => {
		const kernel = boot([]);
		await kernel.start();
		const system = kernel.kernelSdk.domainObjects.get(KernelSystem)!;
		const events: string[] = [];
		system.on("offline", () => void events.push("offline"));
		system.on("appearance-changed", ({ appearance }) => void events.push(appearance));

		kernel.systemEvents.update({ online: false, appearance: "dark" });

		expect(system.getState()).toMatchObject({ online: false, appearance: "dark" });
		expect(events).toEqual(["offline", "dark"]);
	});
});

describe("main kernel — windows", () => {
	function hostWindows(
		overrides: Partial<NonNullable<MainKernelHost["windows"]>> = {},
	): NonNullable<MainKernelHost["windows"]> {
		return {
			open: vi.fn(async () => "w1"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
			...overrides,
		};
	}

	function viewPlugin(id: string) {
		return testPlugin(id, {
			manifest: {
				permissions: { host: ["windows"] },
				contributes: {
					extensions: { "kernel/window-view": [{ id: "board", title: "Board", width: 900 }] },
				},
			},
			entry: { activate: () => {} },
		});
	}

	it("opens a plugin's own window view through the host, with the view's title and size", async () => {
		const open = vi.fn(async () => "w7");
		const kernel = boot([viewPlugin("acme.board")], fakeHost({ windows: hostWindows({ open }) }));
		await kernel.start();

		const windows = kernel.sdkFor("acme.board").domainObjects.get(KernelWindows)!;

		await expect(
			windows.methods.open({ view: "acme.board/board", params: { id: "1" } }),
		).resolves.toEqual({
			windowId: "w7",
			opened: true,
		});
		expect(open).toHaveBeenCalledWith({
			view: "acme.board/board",
			title: "Board",
			params: { id: "1" },
			width: 900,
		});
	});

	it("opens a keyed window once, showing the existing one again", async () => {
		let next = 0;
		const host = hostWindows({ open: vi.fn(async () => `w${++next}`) });
		const kernel = boot([viewPlugin("acme.board")], fakeHost({ windows: host }));
		await kernel.start();
		const windows = kernel.sdkFor("acme.board").domainObjects.get(KernelWindows)!;
		const open = () =>
			windows.methods.open({
				view: "acme.board/board",
				key: "s1/p1",
				title: "Terminal",
				params: { pane: "p1" },
			});

		const [first, racing] = await Promise.all([open(), open()]);
		kernel.windowEvents.opened(first.windowId, { role: "secondary", view: "acme.board/board" });
		await windows.methods.setHidden({ windowId: first.windowId, hidden: true });
		const again = await open();

		expect(first).toEqual({ windowId: "w1", opened: true });
		expect(racing).toEqual({ windowId: "w1", opened: false });
		expect(again).toEqual({ windowId: "w1", opened: false });
		expect(host.open).toHaveBeenCalledTimes(1);
		expect(host.open).toHaveBeenCalledWith(expect.objectContaining({ title: "Terminal" }));
		expect(host.setHidden).toHaveBeenLastCalledWith("w1", false);
		expect(host.focus).toHaveBeenCalledWith("w1");
		expect(windows.getState().windows.w1).toEqual({
			role: "secondary",
			view: "acme.board/board",
			params: { pane: "p1" },
			key: "s1/p1",
			focused: false,
			hidden: false,
		});
	});

	it("hides and shows secondary windows, never the main one", async () => {
		const host = hostWindows();
		const kernel = boot([viewPlugin("acme.board")], fakeHost({ windows: host }));
		await kernel.start();
		const windows = kernel.sdkFor("acme.board").domainObjects.get(KernelWindows)!;
		kernel.windowEvents.opened("main", { role: "main" });
		kernel.windowEvents.opened("w2", { role: "secondary", view: "acme.board/board" });

		await windows.methods.setHidden({ windowId: "w2", hidden: true });

		expect(host.setHidden).toHaveBeenCalledWith("w2", true);
		expect(windows.getState().windows.w2?.hidden).toBe(true);
		await expect(
			windows.methods.setHidden({ windowId: "main", hidden: true }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			windows.methods.setHidden({ windowId: "gone", hidden: true }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("refuses to open another plugin's view, unknown views, or windows without a host", async () => {
		const kernel = boot([
			viewPlugin("acme.board"),
			testPlugin("acme.other", {
				manifest: { permissions: { host: ["windows"] } },
				entry: { activate: () => {} },
			}),
		]);
		await kernel.start();

		await expect(
			kernel
				.sdkFor("acme.other")
				.domainObjects.get(KernelWindows)!
				.methods.open({ view: "acme.board/board" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			kernel
				.sdkFor("acme.board")
				.domainObjects.get(KernelWindows)!
				.methods.open({ view: "acme.board/missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			kernel.sdkFor("acme.board").domainObjects.get(KernelWindows)!.methods.focusMain(undefined),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});
});

describe("main kernel — keybinding overrides", () => {
	it("loads, changes, resets and persists overrides through the host", async () => {
		const save = vi.fn();
		const kernel = boot(
			[],
			fakeHost({ keybindings: { load: () => ({ "acme.a/one": "Alt+KeyO" }), save } }),
		);
		await kernel.start();
		const keybindings = kernel.kernelSdk.domainObjects.get(KernelKeybindings)!;
		expect(keybindings.getState().overrides).toEqual({ "acme.a/one": "Alt+KeyO" });

		await keybindings.methods.setOverride({ command: "acme.a/two", chord: null });
		await keybindings.methods.reset({ command: "acme.a/one" });
		expect(keybindings.getState().overrides).toEqual({ "acme.a/two": null });
		await keybindings.methods.resetAll(undefined);

		expect(save.mock.calls).toEqual([
			[{ "acme.a/one": "Alt+KeyO", "acme.a/two": null }],
			[{ "acme.a/two": null }],
			[{}],
		]);
	});
});

describe("main kernel — disabled plugins", () => {
	function pluginsHost(disabled: string[] = []) {
		const save = vi.fn();
		return {
			save,
			host: fakeHost({ plugins: { loadDisabled: () => disabled, saveDisabled: save } }),
		};
	}

	it("leaves a plugin the user turned off inactive, without its contributions", async () => {
		const activate = vi.fn();
		const { host } = pluginsHost(["acme.off"]);
		const kernel = boot(
			[
				testPlugin("acme.off", {
					manifest: {
						contributes: { extensions: { [KernelCommand.id]: [{ id: "go", title: "Go" }] } },
					},
					entry: { activate },
				}),
				testPlugin("acme.on", { entry: { activate: () => {} } }),
			],
			host,
		);

		await kernel.start();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.pluginState("acme.off")).toBe("disabled");
		expect(kernel.pluginState("acme.on")).toBe("active");
		expect(kernel.extensions.all(KernelCommand).map((command) => command.key)).not.toContain(
			"acme.off/go",
		);
		expect(kernel.kernelSdk.domainObjects.get(KernelPlugins)!.getState()).toMatchObject({
			plugins: { "acme.off": { state: "disabled" } },
			disabled: ["acme.off"],
		});
	});

	it("does not activate a plugin that requires a turned-off plugin", async () => {
		const Thing = defineDomainObject({ id: "acme.lib/thing", home: "main", state: z.object({}) });
		const { host } = pluginsHost(["acme.lib"]);
		const kernel = boot(
			[
				testPlugin("acme.lib", {
					manifest: { domainObjects: [{ id: "thing", home: "main" }] },
					definitions: { domainObjects: [Thing] },
				}),
				testPlugin("acme.app", { manifest: { requires: { "acme.lib/thing": "required" } } }),
			],
			host,
		);

		await kernel.start();

		expect(kernel.pluginState("acme.app")).toBe("unresolved");
		expect(kernel.issues()).toContainEqual(
			expect.objectContaining({
				pluginId: "acme.app",
				message: expect.stringMatching(/turned off/),
			}),
		);
	});

	it("turns plugins off and on for the next launch, persisting through the host", async () => {
		const { host, save } = pluginsHost(["acme.b"]);
		const kernel = boot(
			[
				testPlugin("acme.a", { entry: { activate: () => {} } }),
				testPlugin("acme.b"),
				testPlugin("acme.admin", { manifest: { permissions: { host: ["plugins"] } } }),
			],
			host,
		);
		await kernel.start();
		const plugins = kernel.sdkFor("acme.admin").domainObjects.get(KernelPlugins)!;

		await plugins.methods.setEnabled({ pluginId: "acme.a", enabled: false });
		await plugins.methods.setEnabled({ pluginId: "acme.b", enabled: true });

		expect(plugins.getState().disabled).toEqual(["acme.a"]);
		// This launch is unchanged until the app restarts.
		expect(kernel.pluginState("acme.a")).toBe("active");
		expect(kernel.pluginState("acme.b")).toBe("disabled");
		expect(save.mock.calls).toEqual([[["acme.b", "acme.a"]], [["acme.a"]]]);

		await plugins.methods.setDisabled({ pluginIds: ["acme.a", "acme.b", "acme.a"] });
		expect(plugins.getState().disabled).toEqual(["acme.a", "acme.b"]);
		await plugins.methods.setDisabled({ pluginIds: [] });
		expect(plugins.getState().disabled).toEqual([]);
		expect(save).toHaveBeenLastCalledWith([]);
	});

	it("needs the plugins permission to turn plugins on or off", async () => {
		const { host } = pluginsHost();
		const kernel = boot([testPlugin("acme.a"), testPlugin("acme.nosy")], host);
		await kernel.start();

		await expect(
			kernel
				.sdkFor("acme.nosy")
				.domainObjects.get(KernelPlugins)!
				.methods.setEnabled({ pluginId: "acme.a", enabled: false }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("refuses to turn off a plugin that isn't installed", async () => {
		const { host } = pluginsHost();
		const kernel = boot([], host);
		await kernel.start();

		await expect(
			kernel.kernelSdk.domainObjects
				.get(KernelPlugins)!
				.methods.setEnabled({ pluginId: "acme.ghost", enabled: false }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			kernel.kernelSdk.domainObjects
				.get(KernelPlugins)!
				.methods.setDisabled({ pluginIds: ["acme.ghost"] }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("main kernel — registry hooks", () => {
	it("announces domain objects being provided and withdrawn", async () => {
		const Thing = defineDomainObject({ id: "acme.thing/thing", home: "main", state: z.object({}) });
		const kernel = boot([
			testPlugin("acme.thing", {
				manifest: { domainObjects: [{ id: "thing", home: "main" }] },
				definitions: { domainObjects: [Thing] },
				entry: {
					activate: (sdk) =>
						void sdk.domainObjects.provide(Thing, { initialState: {}, methods: {} }),
				},
			}),
		]);
		const domainObjects = kernel.kernelSdk.domainObjects.get(KernelDomainObjects)!;
		const events: string[] = [];
		domainObjects.on("provided", ({ id }) => void events.push(`provided:${id}`));
		domainObjects.on("withdrawn", ({ id }) => void events.push(`withdrawn:${id}`));

		expect(domainObjects.lookup("acme.thing/thing")).toEqual({
			owner: "acme.thing",
			home: "main",
			provided: false,
		});
		await kernel.start();
		expect(domainObjects.lookup("acme.thing/thing")).toMatchObject({ provided: true });
		expect(domainObjects.lookup("kernel/windows")).toMatchObject({
			owner: "kernel",
			objectType: "kernel/window",
			provided: true,
		});
		await kernel.stop();

		expect(events).toContain("provided:acme.thing/thing");
		expect(events).toContain("withdrawn:acme.thing/thing");
	});

	it("lists extension points and announces contribution changes", async () => {
		const kernel = boot([testPlugin("acme.cmd", { entry: { activate: () => {} } })]);
		await kernel.start();
		const extensions = kernel.kernelSdk.domainObjects.get(KernelExtensions)!;
		const changed: string[] = [];
		extensions.on(
			"contributions-changed",
			({ extensionPointId }) => void changed.push(extensionPointId),
		);

		expect(extensions.lookup("kernel/command")).toMatchObject({
			owner: "kernel",
			kind: "additive",
		});

		kernel.sdkFor("acme.cmd").extensions.add(KernelCommand, { id: "go", title: "Go" });

		expect(changed).toEqual(["kernel/command"]);
	});

	it("reports app focus and suspend transitions as system events", async () => {
		const kernel = boot([]);
		await kernel.start();
		const system = kernel.kernelSdk.domainObjects.get(KernelSystem)!;
		const events: string[] = [];
		for (const name of ["suspend", "resume", "app-blurred", "app-focused", "online"] as const) {
			system.on(name, () => void events.push(name));
		}

		kernel.systemEvents.update({ suspended: true, appFocused: false });
		kernel.systemEvents.update({ suspended: false, appFocused: true });
		kernel.systemEvents.update({ online: true });

		expect(events).toEqual(["app-blurred", "suspend", "app-focused", "resume"]);
	});
});

describe("main kernel — opened URLs", () => {
	it("keeps a URL opened before the window shows as the launch URL, once", async () => {
		const kernel = boot([]);
		await kernel.start();
		const app = kernel.kernelSdk.domainObjects.get(KernelApp)!;
		const announced: string[] = [];
		app.on("url-opened", ({ url }) => void announced.push(url));

		kernel.openUrl("kilo-desktop://model-catalog?model=x");

		await expect(app.methods.takeLaunchUrl(undefined)).resolves.toBe(
			"kilo-desktop://model-catalog?model=x",
		);
		await expect(app.methods.takeLaunchUrl(undefined)).resolves.toBeNull();
		expect(announced).toEqual([]);
	});

	it("announces URLs opened once the window is showing", async () => {
		const kernel = boot([]);
		await kernel.start();
		await kernel.windowShown();
		const announced: string[] = [];
		kernel.kernelSdk.domainObjects
			.get(KernelApp)!
			.on("url-opened", ({ url }) => void announced.push(url));

		kernel.openUrl("kilo-desktop://settings");

		expect(announced).toEqual(["kilo-desktop://settings"]);
	});
});

describe("main kernel — host primitives from windows", () => {
	it("keeps keychain secrets out of windows, whichever plugin they claim to be", async () => {
		const keeper = testPlugin("acme.keeper", {
			manifest: { permissions: { host: ["keychain"] } },
			entry: { activate: () => {} },
		});
		const { main, renderer } = await createTestKernelPair({ main: [keeper], renderer: [keeper] });
		main.kernelSdk.domainObjects.provide(KernelKeychain, {
			initialState: {},
			methods: { get: () => "secret", set: () => {}, delete: () => {} },
		});
		await main.flush();

		await expect(
			main.sdkFor("acme.keeper").domainObjects.get(KernelKeychain)!.methods.get({ key: "token" }),
		).resolves.toBe("secret");
		await expect(
			renderer
				.sdkFor("acme.keeper")
				.domainObjects.get(KernelKeychain)!
				.methods.get({ key: "token" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});
});
