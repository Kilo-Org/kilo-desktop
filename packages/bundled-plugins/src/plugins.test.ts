import { describe, expect, it } from "vitest";

import {
	discoverPlugins,
	KERNEL_CONTEXT_KEYS,
	KERNEL_DEFINITIONS,
	manifestSchema,
} from "@kilo-desktop/kernel";

import { BUNDLED_PLUGINS } from "./plugins";
import { withEntries } from "./registrations";
import { pluginRemovals } from "./removal";

describe("BUNDLED_PLUGINS", () => {
	it("discovers together with the kernel without issues", () => {
		const result = discoverPlugins(withEntries({}, BUNDLED_PLUGINS), {
			kernelDefinitions: KERNEL_DEFINITIONS,
			kernelContextKeys: KERNEL_CONTEXT_KEYS,
		});

		expect(result.issues).toEqual([]);
	});

	it("flags exactly the plugins whose manifest has no web entry as main-only", () => {
		for (const plugin of BUNDLED_PLUGINS) {
			const manifest = manifestSchema.parse(plugin.manifest);

			expect({ id: manifest.id, mainOnly: plugin.mainOnly === true }).toEqual({
				id: manifest.id,
				mainOnly: manifest.web === undefined,
			});
		}
	});

	it("removes each bundled plugin alone, without dragging unrelated plugins", () => {
		const removals = pluginRemovals(BUNDLED_PLUGINS);

		expect(removals.map((removal) => removal.removed).sort()).toEqual(
			BUNDLED_PLUGINS.map((plugin) => (plugin.manifest as { id: string }).id).sort(),
		);
		for (const removal of removals) {
			expect(removal.removedIds, removal.removed).toEqual([removal.removed]);
		}
	});
});
