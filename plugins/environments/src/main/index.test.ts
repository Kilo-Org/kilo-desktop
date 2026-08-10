import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

/**
 * The manifest (`plugin.json`) points at `./src/main/index.ts` for the
 * plugin's main-side entry. Sub-issue 1 ships an empty scaffold that only
 * instantiates {@link ProviderRegistry}; sub-issue 4 wires the conda
 * provider through this same entry. Guarding it at test time keeps a
 * broken import chain, a thrown constructor, or an accidental async
 * `mainRegister` visible in the coverage gate rather than at app boot.
 */
describe("environments plugin main entry", () => {
	it("registers without throwing against a fake main SDK", () => {
		const mainSdk = createFakeMainSdk({ featureId: "environments" });
		expect(() => mainRegister(mainSdk)).not.toThrow();
	});

	it("returns synchronously — mainRegister must not be async in this slice", () => {
		const mainSdk = createFakeMainSdk({ featureId: "environments" });
		// A returned Promise would silently defer registry setup past the
		// shell's boot window. Guarding here means the moment a future slice
		// makes mainRegister async, this test fails and forces the async
		// boot coordination to be addressed explicitly.
		expect(mainRegister(mainSdk)).toBeUndefined();
	});

	it("does not push boot progress messages in the empty scaffold", () => {
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({ featureId: "environments", reportBootProgress });
		mainRegister(mainSdk);
		// v1 has nothing to stage; providers landing in sub-issue 4 will
		// emit their own progress. Asserting silence here catches an
		// accidental progress call slipping into the scaffold.
		expect(reportBootProgress).not.toHaveBeenCalled();
	});
});
