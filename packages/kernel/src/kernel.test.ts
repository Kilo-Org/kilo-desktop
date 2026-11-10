import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineDomainObject } from "./domain-object";
import { defineExtensionPoint } from "./extension-point";
import { createKernel } from "./kernel";
import type { PluginSdk } from "./sdk";
import { testPlugin } from "./test-fixtures";
import { createLinkedTransports } from "./transport";

const Panel = defineExtensionPoint({
	id: "acme.host/panel",
	kind: "additive",
	metadata: z.object({ title: z.string() }),
});

const Store = defineDomainObject({
	id: "acme.host/store",
	home: "main",
	state: z.object({ count: z.number() }),
});

function hostPlugin(activate: (sdk: PluginSdk) => void | Promise<void> = () => {}) {
	return testPlugin("acme.host", {
		manifest: {
			extensionPoints: [{ id: "panel", kind: "additive" }],
			domainObjects: [{ id: "store", home: "main" }],
		},
		definitions: { extensionPoints: [Panel], domainObjects: [Store] },
		entry: { activate },
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("createKernel — plugin runtime", () => {
	it("activates resolved plugins in requires order, each with its own sdk", async () => {
		const activated: string[] = [];
		const kernel = createKernel({
			process: "main",
			registrations: [
				testPlugin("acme.guest", {
					manifest: { requires: { "acme.host/store": "required" } },
					entry: { activate: (sdk) => void activated.push(sdk.pluginId) },
				}),
				hostPlugin((sdk) => void activated.push(sdk.pluginId)),
			],
		});

		await kernel.activate();

		expect(activated).toEqual(["acme.host", "acme.guest"]);
		expect(kernel.pluginState("acme.host")).toBe("active");
		expect(kernel.pluginState("acme.guest")).toBe("active");
	});

	it("never activates unresolved plugins", async () => {
		const activate = vi.fn();
		const kernel = createKernel({
			process: "main",
			registrations: [
				testPlugin("acme.needy", {
					manifest: { requires: { "acme.gone/thing": "required" } },
					entry: { activate },
				}),
			],
		});

		await kernel.activate();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.pluginState("acme.needy")).toBe("unresolved");
	});

	it("isolates a failing activation and rolls back what it registered", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [
				hostPlugin((sdk) => {
					sdk.domainObjects.provide(Store, { initialState: { count: 0 }, methods: {} });
					sdk.extensions.add(Panel, { id: "own", title: "Own" });
					throw new Error("boom");
				}),
				testPlugin("acme.other", { entry: { activate: () => {} } }),
			],
		});

		await kernel.activate();

		expect(kernel.pluginState("acme.host")).toBe("failed");
		expect(kernel.pluginState("acme.other")).toBe("active");
		expect(kernel.issues()).toContainEqual(
			expect.objectContaining({ pluginId: "acme.host", code: "activation-failed" }),
		);
		const reader = kernel.sdkFor("acme.other");
		expect(reader.domainObjects.get(Store)).toBeNull();
		expect(reader.extensions.list(Panel)).toEqual([]);
	});

	it("removes the manifest contributions of a plugin that failed to activate", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [
				hostPlugin(),
				testPlugin("acme.broken", {
					manifest: {
						contributes: { extensions: { "acme.host/panel": [{ id: "a", title: "A" }] } },
					},
					entry: {
						activate: () => {
							throw new Error("nope");
						},
					},
				}),
			],
		});

		await kernel.activate();

		expect(kernel.sdkFor("acme.host").extensions.list(Panel)).toEqual([]);
	});

	it("skips plugins whose required items come from a plugin that failed", async () => {
		const activate = vi.fn();
		const kernel = createKernel({
			process: "main",
			registrations: [
				hostPlugin(() => {
					throw new Error("boom");
				}),
				testPlugin("acme.guest", {
					manifest: { requires: { "acme.host/store": "required" } },
					entry: { activate },
				}),
			],
		});

		await kernel.activate();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.pluginState("acme.guest")).toBe("unresolved");
	});

	it("fails an activation that exceeds the time budget", async () => {
		vi.useFakeTimers();
		const kernel = createKernel({
			process: "main",
			activationBudget: { warnMs: 10, failMs: 100 },
			registrations: [hostPlugin(() => new Promise(() => {}))],
		});

		const activation = kernel.activate();
		await vi.advanceTimersByTimeAsync(100);
		await activation;

		expect(kernel.pluginState("acme.host")).toBe("failed");
		expect(kernel.issues()).toContainEqual(
			expect.objectContaining({ pluginId: "acme.host", code: "activation-timeout" }),
		);
	});

	it("deactivates in reverse order and disposes everything registered through the sdk", async () => {
		const order: string[] = [];
		const kernel = createKernel({
			process: "main",
			registrations: [
				hostPlugin((sdk) => {
					sdk.domainObjects.provide(Store, { initialState: { count: 1 }, methods: {} });
					sdk.onDispose(() => void order.push("host disposed"));
				}),
				testPlugin("acme.guest", {
					entry: {
						activate: (sdk) => {
							sdk.onDispose(() => void order.push("guest disposed"));
						},
						deactivate: () => void order.push("guest deactivate"),
					},
				}),
			],
		});
		await kernel.activate();
		const guestSdk = kernel.sdkFor("acme.guest");
		expect(guestSdk.domainObjects.get(Store)).not.toBeNull();

		await kernel.deactivate();

		expect(order).toEqual(["guest deactivate", "guest disposed", "host disposed"]);
		expect(kernel.pluginState("acme.host")).toBe("resolved");
	});

	it("rejects sdk calls from a plugin after it has been deactivated", async () => {
		let captured: PluginSdk | undefined;
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin((sdk) => void (captured = sdk))],
		});
		await kernel.activate();
		await kernel.deactivate();

		expect(() =>
			captured!.domainObjects.provide(Store, { initialState: { count: 0 }, methods: {} }),
		).toThrow(/not active/);
	});

	it("reports plugin state transitions to subscribers", async () => {
		const transitions: string[] = [];
		const kernel = createKernel({ process: "main", registrations: [hostPlugin()] });
		kernel.onPluginStateChange((pluginId, state) => void transitions.push(`${pluginId}:${state}`));

		await kernel.activate();
		await kernel.deactivate();

		expect(transitions).toEqual([
			"acme.host:activating",
			"acme.host:active",
			"acme.host:deactivating",
			"acme.host:resolved",
		]);
	});
});

describe("createKernel — plugins behind a `when`", () => {
	/** Owns `acme.flags/flag:*`; `set` flips a flag once it has activated. */
	function flagsPlugin(initial: Record<string, boolean> = {}) {
		let sdk: PluginSdk | undefined;
		return {
			set: (flag: string, on: boolean) => sdk!.context.set(`flag:${flag}`, on),
			registration: testPlugin("acme.flags", {
				manifest: { contextKeys: [{ id: "flag:*", scope: "global" }] },
				entry: {
					activate: (flagsSdk) => {
						sdk = flagsSdk;
						for (const [flag, on] of Object.entries(initial)) sdk.context.set(`flag:${flag}`, on);
					},
				},
			}),
		};
	}

	function gatedPlugin(
		entry: { activate?: () => void; deactivate?: () => void } = {},
		when: unknown = { all: ["acme.flags/flag:beta"] },
	) {
		return testPlugin("acme.beta", {
			manifest: {
				when,
				contributes: { extensions: { "acme.host/panel": [{ id: "beta", title: "Beta" }] } },
			},
			entry: {
				activate: entry.activate ?? (() => {}),
				...(entry.deactivate ? { deactivate: entry.deactivate } : {}),
			},
		});
	}

	const panels = (kernel: ReturnType<typeof createKernel>) =>
		kernel
			.sdkFor("acme.host")
			.extensions.list(Panel)
			.map((panel) => panel.id);

	it("leaves a plugin inactive, without its contributions, while its `when` doesn't hold", async () => {
		const activate = vi.fn();
		const flags = flagsPlugin();
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin(), flags.registration, gatedPlugin({ activate })],
		});

		await kernel.activate();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.pluginState("acme.beta")).toBe("inactive");
		expect(panels(kernel)).toEqual([]);
		expect(() => kernel.sdkFor("acme.beta")).toThrow(/not active/);
	});

	it("activates a plugin whose `when` an earlier plugin made true while starting", async () => {
		const flags = flagsPlugin({ beta: true });
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin(), flags.registration, gatedPlugin()],
		});
		const transitions: string[] = [];
		kernel.onPluginStateChange((pluginId, state) => {
			if (pluginId === "acme.beta") transitions.push(state);
		});

		await kernel.activate();

		expect(kernel.pluginState("acme.beta")).toBe("active");
		expect(transitions).toEqual(["activating", "active"]);
		expect(panels(kernel)).toEqual(["beta"]);
	});

	it("activates the plugin, with its contributions, as soon as its `when` holds", async () => {
		const activate = vi.fn();
		const flags = flagsPlugin();
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin(), flags.registration, gatedPlugin({ activate })],
		});
		await kernel.activate();

		flags.set("beta", true);
		await kernel.flush();

		expect(activate).toHaveBeenCalledOnce();
		expect(kernel.pluginState("acme.beta")).toBe("active");
		expect(panels(kernel)).toEqual(["beta"]);
	});

	it("deactivates the plugin, removing its contributions, when its `when` stops holding", async () => {
		const deactivate = vi.fn();
		const activate = vi.fn();
		const flags = flagsPlugin({ beta: true });
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin(), flags.registration, gatedPlugin({ activate, deactivate })],
		});
		await kernel.activate();

		flags.set("beta", false);
		await kernel.flush();

		expect(deactivate).toHaveBeenCalledOnce();
		expect(kernel.pluginState("acme.beta")).toBe("inactive");
		expect(panels(kernel)).toEqual([]);

		flags.set("beta", true);
		await kernel.flush();

		expect(activate).toHaveBeenCalledTimes(2);
		expect(panels(kernel)).toEqual(["beta"]);
	});

	it("stops gated plugins after the plugins that use them, and starts them before", async () => {
		const order: string[] = [];
		const flags = flagsPlugin({ beta: true });
		const Slot = defineExtensionPoint({ id: "acme.base/slot", kind: "additive" });
		const gated = (id: string, manifest: Record<string, unknown>, definitions = {}) =>
			testPlugin(id, {
				manifest: { when: { all: ["acme.flags/flag:beta"] }, ...manifest },
				definitions,
				entry: {
					activate: () => void order.push(`start ${id}`),
					deactivate: () => void order.push(`stop ${id}`),
				},
			});
		const kernel = createKernel({
			process: "main",
			registrations: [
				flags.registration,
				// Registered first, but uses acme.base's point, so it activates after it.
				gated("acme.user", { requires: { "acme.base/slot": "optional" } }),
				gated(
					"acme.base",
					{ extensionPoints: [{ id: "slot", kind: "additive" }] },
					{ extensionPoints: [Slot] },
				),
			],
		});
		await kernel.activate();
		await kernel.flush();
		order.length = 0;

		flags.set("beta", false);
		await kernel.flush();
		flags.set("beta", true);
		await kernel.flush();

		expect(order).toEqual([
			"stop acme.user",
			"stop acme.base",
			"start acme.base",
			"start acme.user",
		]);
	});

	it("settles on the latest value when the `when` flips while the plugin is starting", async () => {
		let finishActivation: () => void = () => {};
		const flags = flagsPlugin();
		const kernel = createKernel({
			process: "main",
			registrations: [
				hostPlugin(),
				flags.registration,
				testPlugin("acme.beta", {
					manifest: { when: { all: ["acme.flags/flag:beta"] } },
					entry: {
						activate: () => new Promise<void>((resolve) => (finishActivation = resolve)),
					},
				}),
			],
		});
		await kernel.activate();

		flags.set("beta", true);
		await vi.waitFor(() => expect(kernel.pluginState("acme.beta")).toBe("activating"));
		flags.set("beta", false);
		finishActivation();
		await kernel.flush();

		expect(kernel.pluginState("acme.beta")).toBe("inactive");
	});

	it("stops following the `when` once the kernel deactivates", async () => {
		const activate = vi.fn();
		const kernel = createKernel({
			process: "main",
			registrations: [hostPlugin(), flagsPlugin().registration, gatedPlugin({ activate })],
		});
		await kernel.activate();
		await kernel.deactivate();

		kernel.contextKeys.set("acme.flags", "acme.flags/flag:beta", true);
		await kernel.flush();

		expect(activate).not.toHaveBeenCalled();
		expect(kernel.pluginState("acme.beta")).toBe("inactive");
	});

	it("rejects a manifest `when` with unqualified keys", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [gatedPlugin({}, { all: ["beta"] })],
		});

		await kernel.activate();

		expect(kernel.pluginState("acme.beta")).toBeUndefined();
		expect(kernel.issues()).toContainEqual(
			expect.objectContaining({ pluginId: "acme.beta", severity: "error" }),
		);
	});
});

describe("createKernel — window hydration", () => {
	it("gives up on a main process that never answers, with a TIMEOUT error", async () => {
		vi.useFakeTimers();
		const transports = createLinkedTransports();
		transports.main.handle("kernel:hydrate", () => new Promise(() => {}));
		const activate = vi.fn();
		const renderer = createKernel({
			process: "renderer",
			windowId: "w1",
			transport: transports.connectRenderer("w1"),
			registrations: [hostPlugin(activate)],
			hydrateTimeoutMs: 1_000,
		});

		const activating = renderer.activate();
		const settled = expect(activating).rejects.toMatchObject({ code: "TIMEOUT" });
		await vi.advanceTimersByTimeAsync(1_000);

		await settled;
		expect(activate).not.toHaveBeenCalled();
	});
});
