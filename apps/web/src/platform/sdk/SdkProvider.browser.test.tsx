import { StrictMode, useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { defineMethod, type FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";
import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { createFeatureSystem, SdkProvider, useSdk, type FeatureSystem } from "./SdkProvider.js";

function fakeLocalApi(): LocalApi {
	return {
		todos: {
			list: async () => [],
			add: async ({ title }) => ({ id: "1", title, completed: false }),
			toggle: async ({ id }) => ({ id, title: "x", completed: true }),
		},
		theme: {
			get: async () => ({ source: "system", shouldUseDarkColors: false }),
			set: async ({ source }) => ({ source, shouldUseDarkColors: source === "dark" }),
			onChanged: () => () => undefined,
		},
		shell: {
			openExternal: async () => ({ opened: true }),
			copyText: async () => undefined,
		},
	};
}

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
	// Node-free feature: same registration in browser mode
	browserRegister: demoRegister,
};

function makeSystem(): FeatureSystem {
	// vitest browser mode has no window.desktopApi → browser mode, boots in-process
	return createFeatureSystem(fakeLocalApi(), [demoFeature]);
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

	it("skips features without browserRegister in browser mode (no mainRegister fallback)", async () => {
		const nodeOnlyFeature: FeatureRegistration = {
			id: "node-only",
			mainRegister(mainSdk) {
				mainSdk.channels(nodeOnlyChannels).handle("list", () => {
					throw new Error("must never boot in the browser");
				});
			},
		};
		const system = createFeatureSystem(fakeLocalApi(), [nodeOnlyFeature]);
		await expect(system.getSdk("node-only").invoke("list")).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
		});
	});

	it("reports undelivered notifications instead of throwing", () => {
		const system = makeSystem();
		const sdk = system.getSdk("demo");
		const result = sdk.notifications.show({ type: "info", title: "Hi", message: "There" });
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/not yet wired/);
	});
});
