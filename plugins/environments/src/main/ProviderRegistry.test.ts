import { describe, expect, it } from "vitest";

import type { EnvironmentProvider } from "./EnvironmentProvider.js";
import { ProviderRegistry } from "./ProviderRegistry.js";

function makeProvider(id: string, displayName = id): EnvironmentProvider {
	return {
		id,
		displayName,
		registerHandlers: () => undefined,
		registerTools: () => undefined,
		webComponents: {
			EnvironmentsPanel: () => null,
			PackagesPanel: () => null,
		},
	};
}

describe("ProviderRegistry", () => {
	it("registers, resolves, and lists providers in registration order", () => {
		const registry = new ProviderRegistry();
		const conda = makeProvider("conda", "Conda");
		const uv = makeProvider("uv", "uv");

		registry.register(conda);
		registry.register(uv);

		expect(registry.has("conda")).toBe(true);
		expect(registry.has("missing")).toBe(false);
		expect(registry.get("conda")).toBe(conda);
		expect(registry.list()).toEqual([conda, uv]);
	});

	it("toInfoList strips components and handlers for renderer consumption", () => {
		const registry = new ProviderRegistry();
		registry.register(makeProvider("conda", "Conda"));
		registry.register(makeProvider("uv", "uv"));

		expect(registry.toInfoList()).toEqual([
			{ id: "conda", displayName: "Conda" },
			{ id: "uv", displayName: "uv" },
		]);
	});

	it("throws on duplicate registration so boot bugs surface loudly", () => {
		const registry = new ProviderRegistry();
		registry.register(makeProvider("conda"));

		expect(() => registry.register(makeProvider("conda"))).toThrow(/already registered/);
	});

	it("get returns undefined for an unknown id", () => {
		const registry = new ProviderRegistry();
		expect(registry.get("nope")).toBeUndefined();
	});
});
