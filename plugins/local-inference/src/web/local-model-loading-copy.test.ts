import { describe, expect, it } from "vitest";

import {
	isLocalModelLoadingStatus,
	localModelLoadingCopy,
	parseLocalInferenceStatus,
	resolveLocalModelName,
} from "./local-model-loading-copy";

describe("isLocalModelLoadingStatus", () => {
	it("is true only while GGUF weights are loading", () => {
		expect(isLocalModelLoadingStatus({ status: "loading-model", modelId: "qwen-3" })).toBe(true);
		expect(isLocalModelLoadingStatus({ status: "preparing-runtime" })).toBe(false);
		expect(isLocalModelLoadingStatus({ status: "starting" })).toBe(false);
		expect(isLocalModelLoadingStatus({ status: "idle" })).toBe(false);
		expect(isLocalModelLoadingStatus({ status: "ready" })).toBe(false);
		expect(isLocalModelLoadingStatus({ status: "error", message: "failed" })).toBe(false);
		expect(isLocalModelLoadingStatus(null)).toBe(false);
	});
});

describe("localModelLoadingCopy", () => {
	it("returns null while the router is coming up", () => {
		expect(localModelLoadingCopy({ status: "preparing-runtime" })).toBeNull();
		expect(localModelLoadingCopy({ status: "starting" })).toBeNull();
	});

	it("uses the catalog name while weights load, then the model id", () => {
		expect(localModelLoadingCopy({ status: "loading-model", modelId: "qwen-3" }, "Qwen 3")).toEqual(
			{
				title: "Loading model...",
				subtitle: "Qwen 3",
			},
		);
		expect(localModelLoadingCopy({ status: "loading-model", modelId: "qwen-3" })).toEqual({
			title: "Loading model...",
			subtitle: "qwen-3",
		});
	});

	it("returns null once loading is over", () => {
		expect(localModelLoadingCopy({ status: "idle" })).toBeNull();
		expect(localModelLoadingCopy({ status: "ready" })).toBeNull();
		expect(localModelLoadingCopy({ status: "error", message: "failed" })).toBeNull();
	});
});

describe("resolveLocalModelName", () => {
	it("prefers the catalog name over the raw model id", () => {
		expect(resolveLocalModelName("qwen-3", [{ modelID: "qwen-3", name: "Qwen 3" }])).toBe("Qwen 3");
		expect(resolveLocalModelName("qwen-3", [])).toBe("qwen-3");
	});
});

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
