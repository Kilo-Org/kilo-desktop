import { describe, expect, it } from "vitest";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { orderMainFeatures } from "./feature-order.js";

function feature(id: string): FeatureRegistration {
	return { id, mainRegister() {} };
}

describe("orderMainFeatures", () => {
	it("boots kilo-server and kilo-ui before built-ins and preserves all other relative order", () => {
		const builtIns = [feature("anaconda-mcp"), feature("another-built-in")];
		const plugins = [feature("kilo-ui"), feature("kilo-server"), feature("todos")];

		const ordered = orderMainFeatures(builtIns, plugins);

		expect(ordered.map(({ id }) => id)).toEqual([
			"kilo-server",
			"kilo-ui",
			"anaconda-mcp",
			"another-built-in",
			"todos",
		]);
		expect(builtIns.map(({ id }) => id)).toEqual(["anaconda-mcp", "another-built-in"]);
		expect(plugins.map(({ id }) => id)).toEqual(["kilo-ui", "kilo-server", "todos"]);
	});
});
