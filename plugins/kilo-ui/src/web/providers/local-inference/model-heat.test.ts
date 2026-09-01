import { describe, expect, it } from "vitest";

import { modelHeat, modelHeatLabel } from "./model-heat.js";

describe("modelHeat", () => {
	it("marks loaded models warm and others cold", () => {
		const status = {
			status: "ready" as const,
			loadedModelId: "tiny-bbbb",
			loadedModelIds: ["tiny-aaaa", "tiny-bbbb"],
		};

		expect(modelHeat(status, "tiny-aaaa")).toBe("warm");
		expect(modelHeat(status, "tiny-bbbb")).toBe("warm");
		expect(modelHeat(status, "tiny-cccc")).toBe("cold");
		expect(
			modelHeat({ status: "ready", loadedModelId: "tiny-aaaa", loadedModelIds: [] }, "tiny-aaaa"),
		).toBe("warm");
		expect(modelHeat({ status: "starting" }, "tiny-aaaa")).toBe("cold");
	});

	it("keeps already loaded models warm while another loads", () => {
		const status = {
			status: "loading-model" as const,
			modelId: "tiny-bbbb",
			loadedModelIds: ["tiny-aaaa"],
		};

		expect(modelHeat(status, "tiny-aaaa")).toBe("warm");
		expect(modelHeat(status, "tiny-bbbb")).toBe("loading");
	});

	it("describes load state for the settings list", () => {
		expect(modelHeatLabel("warm")).toBe("Loaded in memory");
		expect(modelHeatLabel("cold")).toBe("Not loaded yet");
		expect(modelHeatLabel("loading")).toBe("Loading into memory…");
	});
});
