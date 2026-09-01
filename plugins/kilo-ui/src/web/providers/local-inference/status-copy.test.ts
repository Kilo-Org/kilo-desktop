import { describe, expect, it } from "vitest";

import { localProviderStatusText } from "./status-copy.js";

describe("localProviderStatusText", () => {
	it("names how many models the running server has", () => {
		const ready = {
			status: "ready" as const,
			loadedModelIds: [],
			connection: {
				port: 44123,
				baseUrl: "http://127.0.0.1:44123/v1",
				apiKey: "secret",
			},
		};
		expect(localProviderStatusText(ready, { modelCount: 1 })).toBe("Running (1 model)");
		expect(localProviderStatusText(ready, { modelCount: 2 })).toBe("Running (2 models)");
		expect(localProviderStatusText(ready)).toBe("Running (0 models)");
	});

	it("describes startup, errors, and the empty local provider", () => {
		expect(localProviderStatusText({ status: "preparing-runtime" })).toBe("Installing llama.cpp…");
		expect(localProviderStatusText({ status: "starting" })).toBe("Starting local server…");
		expect(localProviderStatusText({ status: "stopping" })).toBe("Stopping…");
		expect(
			localProviderStatusText(
				{ status: "loading-model", modelId: "tiny", loadedModelIds: [] },
				{ modelName: "Gemma" },
			),
		).toBe("Loading Gemma…");
		expect(localProviderStatusText({ status: "error", message: "failed" })).toBe(
			"Local server needs attention",
		);
		expect(localProviderStatusText({ status: "disconnected" }, { modelCount: 1 })).toBe(
			"Stopped (1 model available)",
		);
		expect(localProviderStatusText({ status: "disconnected" }, { modelCount: 2 })).toBe(
			"Stopped (2 models available)",
		);
		expect(localProviderStatusText({ status: "idle" })).toBe("Add a GGUF model to use Local");
		expect(localProviderStatusText(undefined)).toBe("Add a GGUF model to use Local");
		expect(
			localProviderStatusText({ status: "loading-model", modelId: "tiny", loadedModelIds: [] }),
		).toBe("Loading model…");
	});
});
