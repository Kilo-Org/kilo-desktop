import { describe, expect, it } from "vitest";

import { normalizeProviderIconId, resolveProviderIconId } from "./provider-icon-id.js";

describe("resolveProviderIconId", () => {
	it("normalizes casing and whitespace", () => {
		expect(normalizeProviderIconId("  Anthropic ")).toBe("anthropic");
	});

	it("maps kilocode / models.dev aliases to lobehub keys", () => {
		expect(resolveProviderIconId("kilo")).toBe("kilocode");
		expect(resolveProviderIconId("amazon-bedrock")).toBe("bedrock");
		expect(resolveProviderIconId("google-vertex")).toBe("vertexai");
		expect(resolveProviderIconId("cloudflare-workers-ai")).toBe("workersai");
		expect(resolveProviderIconId("github-copilot")).toBe("githubcopilot");
		expect(resolveProviderIconId("vercel-ai-gateway")).toBe("vercel");
	});

	it("passes through unknown ids lowercased", () => {
		expect(resolveProviderIconId("Requesty")).toBe("requesty");
	});
});
