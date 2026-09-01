import { describe, expect, it } from "vitest";

import type { LocalModel } from "../contracts/schemas.js";
import { createProviderEntry, renderModelPreset } from "./provider-config.js";

const models: LocalModel[] = [
	{
		id: "qwen-3-a1b2c3d4",
		name: "Qwen 3",
		path: "/models/Qwen 3.gguf",
		available: true,
		addedAt: 1,
	},
	{
		id: "missing-deadbeef",
		name: "Missing",
		path: "/models/missing.gguf",
		available: false,
		addedAt: 2,
	},
];

describe("local provider configuration", () => {
	it("renders only available models into llama.cpp router presets", () => {
		expect(renderModelPreset(models)).toBe(`[qwen-3-a1b2c3d4]
model = /models/Qwen 3.gguf
`);
	});

	it("writes context length and extra llama.cpp flags into the model preset", () => {
		expect(
			renderModelPreset([
				{
					...models[0]!,
					settings: {
						temperature: 0.2,
						contextLength: 8192,
						maxResponseTokens: 2048,
						llamaFlags: { "n-gpu-layers": "99", "flash-attn": "on" },
					},
				},
			]),
		).toBe(`[qwen-3-a1b2c3d4]
model = /models/Qwen 3.gguf
ctx-size = 8192
flash-attn = on
n-gpu-layers = 99
`);
	});

	it("creates one OpenAI-compatible provider containing every available model", () => {
		expect(createProviderEntry(models, "http://127.0.0.1:43123/v1")).toEqual({
			npm: "@ai-sdk/openai-compatible",
			name: "Local",
			options: {
				baseURL: "http://127.0.0.1:43123/v1",
				headers: { Authorization: "Bearer {env:ANACONDA_LOCAL_LLAMA_API_KEY}" },
			},
			models: {
				"qwen-3-a1b2c3d4": {
					name: "Qwen 3",
					modalities: { input: ["text"], output: ["text"] },
				},
			},
		});
	});
});
