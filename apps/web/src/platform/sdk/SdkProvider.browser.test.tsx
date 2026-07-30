import { StrictMode, useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { DesktopApi } from "@anaconda-agentic-desktop/contracts";
import { defineMethod, type FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";

import {
	createFeatureSystem,
	SdkProvider,
	useFeatureSystem,
	useSdk,
	type FeatureSystem,
} from "./SdkProvider.js";

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
	return createFeatureSystem(createBrowserLocalApi(), features);
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
	document.documentElement.classList.remove("dark");
	vi.unstubAllGlobals();
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
		createFeatureSystem(createBrowserLocalApi(), [broken]);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("reports undelivered notifications instead of throwing", () => {
		const system = makeSystem();
		const sdk = system.getSdk("demo");
		const result = sdk.notifications.show({ type: "info", title: "Hi", message: "There" });
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/not yet wired/);
	});

	it("routes invoke through the Electron bridge when present", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({ ok: true, value: "bridged" }),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("desktopApi", bridge);

		const system = createFeatureSystem(createBrowserLocalApi(), []);
		const result = await system.services.featureRouter.invoke("any", "channel", {});
		expect(result).toBe("bridged");
		expect(bridge.invoke).toHaveBeenCalledWith("feature:invoke", {
			featureId: "any",
			channel: "channel",
			args: {},
		});
	});

	it("throws when the Electron bridge returns ok: false", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "INTERNAL", message: "nope" },
			}),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("desktopApi", bridge);

		const system = createFeatureSystem(createBrowserLocalApi(), []);
		await expect(system.services.featureRouter.invoke("any", "channel", {})).rejects.toThrow(
			"nope",
		);
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
