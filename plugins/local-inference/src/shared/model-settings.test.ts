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
	it("parses pasted llama.cpp command-line arguments", () => {
		expect(
			parseLlamaFlags(`
				--kv-unified --swa-full --flash-attn on
				--n-gpu-layers 99 --cache-ram -1
				--chat-template "chat ml"
			`),
		).toEqual({
			ok: true,
			flags: {
				"cache-ram": "-1",
				"chat-template": "chat ml",
				"flash-attn": "on",
				"kv-unified": "true",
				"n-gpu-layers": "99",
				"swa-full": "true",
			},
		});
	});

	it("accepts flags that override the dedicated model controls", () => {
		expect(
			parseLlamaFlags(
				"--ctx-size 16384 --temp 0.4 --top-p 0.8 --top-k 20 --min-p 0.1 --repeat-penalty 1.2 --presence-penalty 0.3 --n-predict 1024",
			),
		).toEqual({
			ok: true,
			flags: {
				"ctx-size": "16384",
				"min-p": "0.1",
				"n-predict": "1024",
				"presence-penalty": "0.3",
				"repeat-penalty": "1.2",
				temp: "0.4",
				"top-k": "20",
				"top-p": "0.8",
			},
		});
	});

	it("canonicalizes keys and rejects protected or invalid flags", () => {
		expect(parseLlamaFlags("--N_GPU_LAYERS=32")).toEqual({
			ok: true,
			flags: { "n-gpu-layers": "32" },
		});
		expect(parseLlamaFlags("--model /tmp/other.gguf")).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "model".',
		});
		expect(parseLlamaFlags("not a flag")).toEqual({
			ok: false,
			error: 'Each llama.cpp flag must be in the form "name = value".',
		});
	});

	it("rejects duplicate flags", () => {
		expect(parseLlamaFlags("--ngl 1 --ngl 2")).toEqual({
			ok: false,
			error: 'llama.cpp flag "ngl" is set more than once.',
		});
	});

	it("keeps legacy key-value syntax when it follows a comment", () => {
		expect(parseLlamaFlags("# GPU settings\nn-gpu-layers = 99")).toEqual({
			ok: true,
			flags: { "n-gpu-layers": "99" },
		});
	});

	it("preserves an unquoted hash at the start of a flag value", () => {
		expect(parseLlamaFlags("--color #ffffff")).toEqual({
			ok: true,
			flags: { color: "#ffffff" },
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

	it("canonicalizes keys and rejects protected, blank, or duplicate rows", () => {
		expect(llamaFlagsFromRows([{ key: "N_GPU_LAYERS", value: "32" }])).toEqual({
			ok: true,
			flags: { "n-gpu-layers": "32" },
		});
		expect(llamaFlagsFromRows([{ key: "n-gpu-layers", value: "" }])).toEqual({
			ok: false,
			error: "Flag name and value are both required.",
		});
		expect(llamaFlagsFromRows([{ key: "model", value: "/tmp/other.gguf" }])).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "model".',
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
	it("accepts llama.cpp sampling settings and rejects values outside their UI ranges", () => {
		expect(
			localModelSettingsSchema.safeParse({
				topP: 0.95,
				topK: 64,
				minP: 0.05,
				repeatPenalty: 1.1,
				presencePenalty: 0.2,
				maxResponseTokens: 4096,
			}).success,
		).toBe(true);
		expect(localModelSettingsSchema.safeParse({ topP: 1.01 }).success).toBe(false);
		expect(localModelSettingsSchema.safeParse({ topK: 101 }).success).toBe(false);
		expect(localModelSettingsSchema.safeParse({ minP: -0.01 }).success).toBe(false);
		expect(localModelSettingsSchema.safeParse({ repeatPenalty: 2.1 }).success).toBe(false);
		expect(localModelSettingsSchema.safeParse({ presencePenalty: -0.1 }).success).toBe(false);
	});

	it("rejects app-managed llama.cpp flags stored on a model", () => {
		expect(localModelSettingsSchema.safeParse({ llamaFlags: { port: "8080" } }).success).toBe(
			false,
		);
		expect(
			localModelSettingsSchema.safeParse({ llamaFlags: { model: "/tmp/other.gguf" } }).success,
		).toBe(false);
		expect(localModelSettingsSchema.safeParse({ llamaFlags: { temp: "0.4" } }).success).toBe(true);
		expect(localModelSettingsSchema.safeParse({ llamaFlags: { "flash-attn": "on" } }).success).toBe(
			true,
		);
		expect(localModelSettingsSchema.safeParse({}).success).toBe(true);
	});
});

describe("serializeLlamaFlags", () => {
	it("writes pasteable command-line arguments in stable key order", () => {
		expect(
			serializeLlamaFlags({
				"n-gpu-layers": "99",
				"flash-attn": "on",
				"kv-unified": "true",
				"chat-template": "chat ml",
			}),
		).toBe('--chat-template "chat ml"\n--flash-attn on\n--kv-unified\n--n-gpu-layers 99');
	});
});

describe("compactModelSettings", () => {
	it("omits empty settings so defaults stay unset", () => {
		expect(compactModelSettings({})).toBeUndefined();
		expect(compactModelSettings({ llamaFlags: {} })).toBeUndefined();
		expect(
			compactModelSettings({
				temperature: 0.2,
				topP: 0.9,
				topK: 64,
				minP: 0.05,
				repeatPenalty: 1.1,
				presencePenalty: 0.2,
				contextLength: 8192,
				maxResponseTokens: 2048,
				llamaFlags: { "flash-attn": "on" },
			}),
		).toEqual({
			temperature: 0.2,
			topP: 0.9,
			topK: 64,
			minP: 0.05,
			repeatPenalty: 1.1,
			presencePenalty: 0.2,
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
