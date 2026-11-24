import { describe, expect, it } from "vitest";

import { sharedModuleSource } from "./external-plugin-modules.js";

describe("sharedModuleSource", () => {
	it("re-exports a shared instance's named and default exports", () => {
		const source = sharedModuleSource("zod", {
			z: {},
			object: () => {},
			default: {},
			"not-an-id": 1,
		});

		expect(source).toContain('globalThis[Symbol.for("kilo-desktop.plugin-shared-modules")]["zod"]');
		expect(source).toContain("export default shared.default ?? shared;");
		expect(source).toContain("export const { z, object } = shared;");
		expect(source).not.toContain("not-an-id");
	});
});
