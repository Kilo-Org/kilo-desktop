import { describe, expect, it } from "vitest";
import { createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { sdkProducerContract, type Note } from "@anaconda-agentic-desktop/contracts";
import { defineMethod } from "@anaconda-agentic-desktop/feature-sdk";
import { z } from "zod";

/**
 * Tests for the sdk-producer renderer layer.
 *
 * The createFakeSdk is built on REAL in-memory services (EventBus,
 * StateBroker, registries, router). This means events, state, plugins,
 * commands, and contributions all behave identically to production.
 * Only shell delegates are fakes.
 */
describe("sdk-producer renderer — real SDK services via createFakeSdk", () => {
	it("sdk.client routes to handlers registered via channels + handlers", async () => {
		const mockNotes: Note[] = [
			{ id: "1", text: "hello", createdAt: 1000 },
			{ id: "2", text: "world", createdAt: 2000 },
		];

		const sdk = createFakeSdk({
			featureId: "sdk-producer",
			channels: sdkProducerContract,
			handlers: {
				list: () => mockNotes,
				echo: (args: { message: string }) => ({
					echoed: `[echo] ${args.message}`,
					timestamp: Date.now(),
				}),
			},
		});

		const result = await sdk.invoke("list");
		expect(result).toEqual(mockNotes);

		const echoResult = (await sdk.invoke("echo", { message: "hi" })) as { echoed: string };
		expect(echoResult.echoed).toBe("[echo] hi");
	});

	it("sdk.invoke throws FeatureError for unknown channel", async () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer", channels: sdkProducerContract });
		await expect(sdk.invoke("nonexistent")).rejects.toThrow(/No handler/);
	});

	it("sdk.events.emit and on work (real EventBus)", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		const received: unknown[] = [];

		sdk.events.on("sdk-producer.note-added", (payload) => {
			received.push(payload);
		});

		sdk.events.emit("note-added", { id: "1", text: "hello" });

		expect(received).toEqual([{ id: "1", text: "hello" }]);
	});

	it("sdk.events.on returns working unsubscribe function", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		const received: unknown[] = [];

		const unsub = sdk.events.on("sdk-producer.ping", (p) => received.push(p));
		sdk.events.emit("ping", "first");
		expect(received).toEqual(["first"]);

		unsub();
		sdk.events.emit("ping", "second");
		expect(received).toEqual(["first"]);
	});

	it("sdk.state.register and get work with real StateBroker", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		const handle = sdk.state.register("click-count", 0);

		const store = sdk.state.get<number>("sdk-producer.click-count");
		let current: number | null = null;
		store.subscribe((v) => {
			current = v;
		});
		expect(current).toBe(0);

		handle.set(5);
		expect(current).toBe(5);

		expect(sdk.state.peek("sdk-producer.click-count")).toBe(5);
	});

	it("sdk.state.get returns null for unregistered store (lazy resolution)", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		const store = sdk.state.get<number>("sdk-producer.nonexistent");
		expect(store.peek()).toBeNull();
	});

	it("sdk.plugins.expose and get round-trip (real CapabilityRegistry)", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		sdk.plugins.expose("explorerService", {
			getInfo: () => ({ name: "sdk-producer", version: "2.0.0" }),
		});

		const cap = sdk.plugins.get("sdk-producer");
		expect(cap).not.toBeNull();
		expect(cap!.explorerService).toBeDefined();
		const info = (cap!.explorerService as { getInfo: () => { version: string } }).getInfo();
		expect(info.version).toBe("2.0.0");
	});

	it("sdk.contribute registers in the real ContributionRegistry", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		sdk.contribute("status-bar", {
			component: "StatusWidget",
			label: "SDK Explorer Status",
			priority: 5,
		});

		const contributions = sdk.services.contributionRegistry.getForZone("status-bar");
		expect(contributions).toHaveLength(1);
		expect(contributions[0]!.label).toBe("SDK Explorer Status");
		expect(contributions[0]!.featureId).toBe("sdk-producer");
	});

	it("sdk.commands.register works with real CommandRegistry", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		let executed = false;
		sdk.commands.register({
			id: "test-cmd",
			label: "Test Command",
			handler: () => {
				executed = true;
			},
		});

		const commands = sdk.services.commandRegistry.all();
		expect(commands.some((c: { id: string }) => c.id === "sdk-producer.test-cmd")).toBe(true);

		const cmd = commands.find((c: { id: string }) => c.id === "sdk-producer.test-cmd");
		cmd?.handler();
		expect(executed).toBe(true);
	});

	it("sdk.notifications.show and setBadge are no-ops by default in fake", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		expect(() => sdk.notifications.show({ title: "T", message: "M", type: "info" })).not.toThrow();
		expect(() => sdk.notifications.setBadge(3)).not.toThrow();
	});

	it("sdk.theme.peek returns 'light' by default in fake", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		expect(sdk.theme.peek()).toBe("light");
	});

	it("sdk.theme.subscribe fires synchronously with current value", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		let received: string | null = null;
		sdk.theme.subscribe((t) => {
			received = t;
		});
		expect(received).toBe("light");
	});

	it("sdk.shell.copyText and openExternal return promises", async () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		await expect(sdk.shell.copyText("test")).resolves.toBeUndefined();
		await expect(sdk.shell.openExternal("https://example.com")).resolves.toEqual({ opened: true });
	});

	it("sdk.fs methods throw 'not implemented' by default in fake", async () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		await expect(async () => sdk.fs.exists("x")).rejects.toThrow(/not implemented/i);
	});

	it("deferred APIs (tools, intents, navigate, dispatch) throw", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		expect(() => sdk.tools.register({})).toThrow(/not available yet/);
		expect(() => sdk.intents.list()).toThrow(/not available yet/);
		expect(() => sdk.navigate({ plugin: "x", intent: "y" })).toThrow(/not available yet/);
		expect(() => sdk.dispatch({ plugin: "x", action: "y" })).toThrow(/not available yet/);
	});

	it("sdk.destroy cleans up registrations", () => {
		const sdk = createFakeSdk({ featureId: "sdk-producer" });
		sdk.state.register("counter", 42);
		sdk.plugins.expose("svc", { hello: () => "world" });
		sdk.contribute("dashboard", { component: "Widget", label: "W" });

		let disposed = false;
		sdk.onDispose(() => {
			disposed = true;
		});

		sdk.destroy();
		expect(disposed).toBe(true);

		expect(sdk.services.stateBroker.peek("sdk-producer.counter")).toBeNull();
		expect(sdk.services.capabilityRegistry.get("sdk-producer")).toBeNull();
		expect(sdk.services.contributionRegistry.getForZone("dashboard")).toHaveLength(0);
	});

	it("sdk.destroy makes subsequent calls throw", async () => {
		const pingChannels = {
			ping: defineMethod(z.undefined(), z.string()),
		};
		const sdk = createFakeSdk({
			featureId: "sdk-producer",
			channels: pingChannels,
			handlers: { ping: () => "pong" },
		});
		sdk.destroy();
		await expect(sdk.invoke("ping")).rejects.toThrow(/destroyed/);
	});
});
