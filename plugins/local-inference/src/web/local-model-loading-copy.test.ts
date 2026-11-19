import { describe, expect, it } from "vitest";

import { parseLocalInferenceStatus } from "./local-model-loading-copy";

describe("parseLocalInferenceStatus", () => {
	it("accepts known status payloads and rejects junk", () => {
		expect(parseLocalInferenceStatus({ status: "idle" })).toEqual({ status: "idle" });
		expect(parseLocalInferenceStatus({ status: "disconnected" })).toEqual({ status: "idle" });
		expect(parseLocalInferenceStatus({ status: "stopping" })).toEqual({ status: "idle" });
		expect(parseLocalInferenceStatus({ status: "loading-model", modelId: "qwen-3" })).toEqual({
			status: "loading-model",
			modelId: "qwen-3",
		});
		expect(parseLocalInferenceStatus({ status: "ready", loadedModelId: "qwen-3" })).toEqual({
			status: "ready",
			loadedModelId: "qwen-3",
		});
		expect(parseLocalInferenceStatus({ status: "loading-model" })).toBeNull();
		expect(parseLocalInferenceStatus({ status: "unknown" })).toBeNull();
		expect(parseLocalInferenceStatus(null)).toBeNull();
	});
});
