import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { LaunchDarklyFlagSource } from "./flag-source";
import type { FeatureFlagEvents, FeatureFlagProvider } from "./types";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function provider(flags: Record<string, unknown>) {
	const emitter = new EventEmitter<FeatureFlagEvents>();
	return Object.assign(emitter, {
		start: async () => "complete" as const,
		getFlag: <T>(_key: string, fallback?: T) => fallback as T,
		getAllFlags: () => flags,
		identify: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	}) satisfies FeatureFlagProvider;
}

describe("LaunchDarklyFlagSource", () => {
	it("has no values, and asks LaunchDarkly nothing, until started", async () => {
		const ld = provider({ beta: true });
		const source = new LaunchDarklyFlagSource({ provider: ld, logger: silent });

		await source.identify({ primary: null, linked: [] });

		expect(source.values()).toBeNull();
		expect(ld.identify).not.toHaveBeenCalled();
	});

	it("serves values the SDK reports before it is started, e.g. from its cache", () => {
		const ld = provider({ beta: true });
		const source = new LaunchDarklyFlagSource({ provider: ld, logger: silent });
		const listener = vi.fn();
		source.subscribe(listener);

		ld.emit("change");

		expect(listener).toHaveBeenCalledOnce();
		expect(source.values()).toEqual({ beta: true });
	});

	it("stops notifying once disposed", async () => {
		const ld = provider({});
		const source = new LaunchDarklyFlagSource({ provider: ld, logger: silent });
		const listener = vi.fn();
		const stop = source.subscribe(listener);
		stop();

		await source.start();
		await source.dispose();

		expect(listener).not.toHaveBeenCalled();
		expect(ld.dispose).toHaveBeenCalledOnce();
	});
});
