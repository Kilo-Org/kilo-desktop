import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import type { PluginNavEntry } from "./plugin-nav";
import { useVisiblePluginNav } from "./plugin-nav";

afterEach(() => {
	cleanup();
});

/** Minimal controllable feature-flag store matching the shell delegate shape. */
function createFlagStore(initial: Record<string, unknown> = {}) {
	let flags = { ...initial };
	const listeners = new Set<(flags: Record<string, unknown>) => void>();
	return {
		delegate: {
			getAllFlags: async () => flags,
			peek: () => flags,
			subscribe: (fn: (flags: Record<string, unknown>) => void) => {
				fn(flags);
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		},
		set(next: Record<string, unknown>) {
			flags = { ...next };
			for (const listener of listeners) listener(flags);
		},
	};
}

function makeEntry(
	overrides: Partial<PluginNavEntry> & Pick<PluginNavEntry, "label">,
): PluginNavEntry {
	return {
		pluginId: "demo",
		to: `/plugins/${overrides.label.toLowerCase()}`,
		icon: undefined,
		iconComponent: undefined,
		priority: 1,
		splat: overrides.label.toLowerCase(),
		navQaId: `nav-${overrides.label.toLowerCase()}`,
		featureFlag: undefined,
		...overrides,
	};
}

const ALWAYS = makeEntry({ label: "Always" });
const GATED = makeEntry({ label: "Gated", featureFlag: "demo-flag" });

function renderVisibleLabels(store: ReturnType<typeof createFlagStore>) {
	const sdk = createFakeSdk({ featureId: "demo", featureFlags: store.delegate });
	const system = createFakeFeatureSystem({ sdks: { demo: sdk } });

	let latest: readonly PluginNavEntry[] = [];
	function Probe() {
		latest = useVisiblePluginNav([ALWAYS, GATED]);
		return <span data-qa-id="labels">{latest.map((entry) => entry.label).join(",")}</span>;
	}

	const view = render(
		<SdkProvider system={system}>
			<Probe />
		</SdkProvider>,
	);
	return { view, labels: () => latest.map((entry) => entry.label) };
}

describe("useVisiblePluginNav", () => {
	it("hides a gated entry when its flag is falsy and re-shows it when the flag flips", async () => {
		const store = createFlagStore({ "demo-flag": false });
		const { labels } = renderVisibleLabels(store);

		expect(labels()).toEqual(["Always"]);

		store.set({ "demo-flag": true });

		await expect.poll(() => labels()).toEqual(["Always", "Gated"]);
	});

	it("keeps all entries when none declare a feature flag (empty required keys)", () => {
		const store = createFlagStore({});
		const sdk = createFakeSdk({ featureId: "demo", featureFlags: store.delegate });
		const system = createFakeFeatureSystem({ sdks: { demo: sdk } });

		let latest: readonly PluginNavEntry[] = [];
		function Probe() {
			latest = useVisiblePluginNav([ALWAYS]);
			return null;
		}

		render(
			<SdkProvider system={system}>
				<Probe />
			</SdkProvider>,
		);

		expect(latest.map((entry) => entry.label)).toEqual(["Always"]);
	});
});
