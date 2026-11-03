import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineDomain } from "./domain";
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

const Store = defineDomain({
	id: "acme.host/store",
	home: "main",
	state: z.object({ count: z.number() }),
});

function hostPlugin(activate: (sdk: PluginSdk) => void | Promise<void> = () => {}) {
	return testPlugin("acme.host", {
		manifest: {
			extensionPoints: [{ id: "panel", kind: "additive" }],
			domains: [{ id: "store", home: "main" }],
		},
		definitions: { extensionPoints: [Panel], domains: [Store] },
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
					sdk.domains.provide(Store, { initialState: { count: 0 }, methods: {} });
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
		expect(reader.domains.get(Store)).toBeNull();
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
					sdk.domains.provide(Store, { initialState: { count: 1 }, methods: {} });
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
		expect(guestSdk.domains.get(Store)).not.toBeNull();

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
			captured!.domains.provide(Store, { initialState: { count: 0 }, methods: {} }),
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
