import { describe, expect, it } from "vitest";

import {
	compactModelSettings,
	llamaFlagsFromRows,
	localModelSettingsSchema,
	parseLlamaFlagRow,
	parseLlamaFlags,
	serializeLlamaFlags,
} from "./model-settings.js";

describe("parseLlamaFlags", () => {
	it("parses INI-style llama.cpp flags and skips blanks and comments", () => {
		expect(
			parseLlamaFlags(`
# GPU
n-gpu-layers = 99
flash-attn = on
			`),
		).toEqual({
			ok: true,
			flags: {
				"flash-attn": "on",
				"n-gpu-layers": "99",
			},
		});
	});

	it("canonicalizes keys and rejects reserved or invalid flags", () => {
		expect(parseLlamaFlags("N_GPU_LAYERS = 32")).toEqual({
			ok: true,
			flags: { "n-gpu-layers": "32" },
		});
		expect(parseLlamaFlags("ctx-size = 8192")).toEqual({
			ok: false,
			error: "Set context length in Model settings, not as a llama.cpp flag.",
		});
		expect(parseLlamaFlags("temp = 0.2")).toEqual({
			ok: false,
			error: "Set temperature in Model settings, not as a llama.cpp flag.",
		});
		expect(parseLlamaFlags("n-predict = 2048")).toEqual({
			ok: false,
			error: "Set maximum response length in Model settings, not as a llama.cpp flag.",
		});
		expect(parseLlamaFlags("model = /tmp/other.gguf")).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "model".',
		});
		expect(parseLlamaFlags("not a flag")).toEqual({
			ok: false,
			error: 'Each llama.cpp flag must be in the form "name = value".',
		});
	});

	it("rejects duplicate flags", () => {
		expect(parseLlamaFlags("ngl = 1\nngl = 2")).toEqual({
			ok: false,
			error: 'llama.cpp flag "ngl" is set more than once.',
		});
	});
});

describe("llamaFlagsFromRows", () => {
	it("builds llama.cpp flags from name and value rows", () => {
		expect(
			llamaFlagsFromRows([
				{ key: "n-gpu-layers", value: "99" },
				{ key: "flash-attn", value: "on" },
			]),
		).toEqual({
			ok: true,
			flags: {
				"flash-attn": "on",
				"n-gpu-layers": "99",
			},
		});
	});

	it("canonicalizes keys and rejects reserved, blank, or duplicate rows", () => {
		expect(llamaFlagsFromRows([{ key: "N_GPU_LAYERS", value: "32" }])).toEqual({
			ok: true,
			flags: { "n-gpu-layers": "32" },
		});
		expect(llamaFlagsFromRows([{ key: "n-gpu-layers", value: "" }])).toEqual({
			ok: false,
			error: "Flag name and value are both required.",
		});
		expect(llamaFlagsFromRows([{ key: "ctx-size", value: "8192" }])).toEqual({
			ok: false,
			error: "Set context length in Model settings, not as a llama.cpp flag.",
		});
		expect(
			llamaFlagsFromRows([
				{ key: "ngl", value: "1" },
				{ key: "ngl", value: "2" },
			]),
		).toEqual({
			ok: false,
			error: 'llama.cpp flag "ngl" is set more than once.',
		});
		expect(parseLlamaFlagRow("n gpu layers", "99")).toEqual({
			ok: false,
			error: 'Each llama.cpp flag name must be like "n-gpu-layers".',
		});
	});
});

describe("localModelSettingsSchema", () => {
	it("rejects reserved llama.cpp flags stored on a model", () => {
		expect(localModelSettingsSchema.safeParse({ llamaFlags: { port: "8080" } }).success).toBe(
			false,
		);
		expect(localModelSettingsSchema.safeParse({ llamaFlags: { "flash-attn": "on" } }).success).toBe(
			true,
		);
		expect(localModelSettingsSchema.safeParse({}).success).toBe(true);
	});
});

describe("serializeLlamaFlags", () => {
	it("writes flags in stable key order", () => {
		expect(serializeLlamaFlags({ "n-gpu-layers": "99", "flash-attn": "on" })).toBe(
			"flash-attn = on\nn-gpu-layers = 99",
		);
	});
});

describe("compactModelSettings", () => {
	it("omits empty settings so defaults stay unset", () => {
		expect(compactModelSettings({})).toBeUndefined();
		expect(compactModelSettings({ llamaFlags: {} })).toBeUndefined();
		expect(
			compactModelSettings({
				temperature: 0.2,
				contextLength: 8192,
				maxResponseTokens: 2048,
				llamaFlags: { "flash-attn": "on" },
			}),
		).toEqual({
			temperature: 0.2,
			contextLength: 8192,
			maxResponseTokens: 2048,
			llamaFlags: { "flash-attn": "on" },
		});
		expect(compactModelSettings({ includeKiloContext: false })).toBeUndefined();
		expect(compactModelSettings({ includeKiloContext: true })).toEqual({
			includeKiloContext: true,
		});
	});
});
