import { StrictMode, useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	defineMethod,
	type FeatureEvent,
	type FeatureRegistration,
	type MainSdk,
} from "@anaconda-agentic-desktop/feature-sdk";

import {
	createFeatureSystem,
	SdkProvider,
	useFeatureSystem,
	useSdk,
	type FeatureSystem,
} from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";

const undefinedSchema = {
	parse(value: unknown): undefined {
		if (value !== undefined) throw new Error("Expected undefined.");
		return undefined;
	},
};

const demoChannels = {
	greet: defineMethod(
		{
			parse(value: unknown): { name: string } {
				if (
					typeof value !== "object" ||
					value === null ||
					!("name" in value) ||
					typeof value.name !== "string"
				) {
					throw new Error("Expected an object with a string name.");
				}
				return { name: value.name };
			},
		},
		{
			parse(value: unknown): string {
				if (typeof value !== "string") throw new Error("Expected a string.");
				return value;
			},
		},
	),
} as const;

const nodeOnlyChannels = {
	list: defineMethod(undefinedSchema, { parse: (value: unknown) => value }),
} as const;

function demoRegister(mainSdk: Parameters<FeatureRegistration["mainRegister"]>[0]) {
	mainSdk.channels(demoChannels).handle("greet", (args) => `Hello, ${args.name}!`);
}

const demoFeature: FeatureRegistration = {
	id: "demo",
	mainRegister: demoRegister,
	browserRegister: demoRegister,
};

function makeSystem(features: FeatureRegistration[] = [demoFeature]): FeatureSystem {
	return createFeatureSystem({ shellDelegates: createTestShellDelegates(), features });
}

function Probe() {
	const sdk = useSdk("demo");
	const [value, setValue] = useState("loading");
	useEffect(() => {
		let active = true;
		void sdk
			.invoke("greet", { name: "World" })
			.then((result) => {
				if (active) setValue(String(result));
			})
			.catch((error: unknown) => {
				if (active) setValue(`error: ${error instanceof Error ? error.message : String(error)}`);
			});
		return () => {
			active = false;
		};
	}, [sdk]);
	return <output>{value}</output>;
}

afterEach(() => {
	cleanup();
});

describe("SdkProvider + useSdk", () => {
	it("invokes feature handlers under StrictMode", async () => {
		const { baseElement } = render(
			<StrictMode>
				<SdkProvider system={makeSystem()}>
					<Probe />
				</SdkProvider>
			</StrictMode>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("Hello, World!")).toBeVisible();
	});

	it("keeps working after unmount and remount (SDK survives component lifecycle)", async () => {
		const system = makeSystem();
		const ui = (
			<StrictMode>
				<SdkProvider system={system}>
					<Probe />
				</SdkProvider>
			</StrictMode>
		);

		const first = render(ui);
		await expect
			.element(page.elementLocator(first.baseElement).getByText("Hello, World!"))
			.toBeVisible();
		first.unmount();

		const second = render(ui);
		await expect
			.element(page.elementLocator(second.baseElement).getByText("Hello, World!"))
			.toBeVisible();
	});

	it("returns the same shared SDK instance for the same feature", () => {
		const system = makeSystem();
		expect(system.getSdk("demo")).toBe(system.getSdk("demo"));
	});

	it("tears down cached SDK instances", () => {
		const system = makeSystem();
		const sdk = system.getSdk("demo");
		system.teardownFeature("demo");
		expect(system.getSdk("demo")).not.toBe(sdk);
	});

	it("skips features without browserRegister in browser mode (no mainRegister fallback)", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const nodeOnlyFeature: FeatureRegistration = {
			id: "node-only",
			mainRegister(mainSdk) {
				mainSdk.channels(nodeOnlyChannels).handle("list", () => {
					throw new Error("must never boot in the browser");
				});
			},
		};
		const system = makeSystem([nodeOnlyFeature]);
		await expect(system.getSdk("node-only").invoke("list")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
		});
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/no browserRegister/));
		warnSpy.mockRestore();
	});

	it("catches browserRegister boot failures", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const broken: FeatureRegistration = {
			id: "broken",
			mainRegister() {},
			browserRegister() {
				throw new Error("boot boom");
			},
		};
		createFeatureSystem({ shellDelegates: createTestShellDelegates(), features: [broken] });
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("exposes the host-provided shell delegates on the SDK", () => {
		const system = makeSystem();
		const sdk = system.getSdk("demo");
		expect(sdk.theme.peek()).toBe("light");
		expect(sdk.notifications.show({ type: "info", title: "Hi", message: "There" })).toEqual({
			delivered: true,
		});
	});

	it("routes invoke through the invokeFallback when provided, without booting features", async () => {
		const browserBoot = vi.fn();
		const invokeFallback = vi.fn().mockResolvedValue("bridged");
		const system = createFeatureSystem({
			shellDelegates: createTestShellDelegates(),
			invokeFallback,
			features: [{ id: "demo", mainRegister: demoRegister, browserRegister: browserBoot }],
		});

		await expect(system.getSdk("demo").invoke("greet", { name: "x" })).resolves.toBe("bridged");
		expect(invokeFallback).toHaveBeenCalledWith("demo", "greet", { name: "x" });
		expect(browserBoot).not.toHaveBeenCalled();
	});

	it("shares one event bus and capability registry with browser MainSdk", () => {
		let browserMainSdk: MainSdk | undefined;
		const feature: FeatureRegistration = {
			id: "producer",
			mainRegister() {},
			browserRegister(mainSdk) {
				browserMainSdk = mainSdk;
				mainSdk.plugins.expose("service", { read: () => "ready" });
			},
		};
		const system = makeSystem([feature]);
		const rendererSdk = system.getSdk("consumer");
		const listener = vi.fn();
		rendererSdk.events.on("producer.changed", listener);

		browserMainSdk!.events.emit("changed", { id: "1" });

		expect(listener).toHaveBeenCalledWith({ id: "1" });
		expect(rendererSdk.plugins.get("producer")).toEqual({
			service: { read: expect.any(Function) },
		});
	});

	it("relays outbound events and does not echo inbound events", () => {
		const emit = vi.fn();
		let deliver: ((event: FeatureEvent) => void) | undefined;
		const system = createFeatureSystem({
			shellDelegates: createTestShellDelegates(),
			invokeFallback: vi.fn(),
			eventTransport: {
				emit,
				onEvent(handler) {
					deliver = handler;
					return () => undefined;
				},
			},
		});
		const sdk = system.getSdk("producer");
		const listener = vi.fn();
		sdk.events.on("producer.changed", listener);

		sdk.events.emit("changed", { source: "local" });
		deliver!({ featureId: "producer", name: "changed", payload: { source: "main" } });

		expect(listener).toHaveBeenCalledTimes(2);
		expect(emit).toHaveBeenCalledOnce();
	});
});

describe("useFeatureSystem", () => {
	it("throws outside SdkProvider", () => {
		function Outside() {
			useFeatureSystem();
			return null;
		}
		expect(() => render(<Outside />)).toThrow(/must be used within <SdkProvider>/);
	});

	it("returns the provided system", () => {
		const system = makeSystem();
		let seen: FeatureSystem | null = null;
		function Inside() {
			seen = useFeatureSystem();
			return null;
		}
		render(
			<SdkProvider system={system}>
				<Inside />
			</SdkProvider>,
		);
		expect(seen).toBe(system);
	});
});
