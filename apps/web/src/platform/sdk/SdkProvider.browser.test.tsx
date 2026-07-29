import { StrictMode, useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";
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

function demoRegister(mainSdk: Parameters<FeatureRegistration["mainRegister"]>[0]) {
	mainSdk.handle("greet", null, (args) => `Hello, ${(args as { name: string }).name}!`);
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
				mainSdk.handle("list", null, () => {
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
