import { describe, expect, it } from "vitest";

import { kiloInlineConfigContent } from "./kilo-inline-config.js";

const API = "https://api.kilo.ai";

describe("Kilo inline config", () => {
	it("makes archive commands ask through v2 shell permission rules", () => {
		expect(JSON.parse(kiloInlineConfigContent(API))).toMatchObject({
			permissions: [
				{ action: "shell", resource: "tar *", effect: "ask" },
				{ action: "shell", resource: "unzip *", effect: "ask" },
				{ action: "shell", resource: "gzip *", effect: "ask" },
				{ action: "shell", resource: "gunzip *", effect: "ask" },
			],
		});
	});

	it("pins the Kilo embedder to the gateway base v2 derives from KILO_API_URL", () => {
		expect(JSON.parse(kiloInlineConfigContent(`${API}/`))).toMatchObject({
			indexing: { kilo: { baseUrl: "https://api.kilo.ai/api/gateway/v1" } },
		});
	});

	it("uses only v2 keys, which v2 reads without migrating", () => {
		const config = JSON.parse(kiloInlineConfigContent(API)) as Record<string, unknown>;
		expect(Object.keys(config)).toEqual(["permissions", "indexing"]);
	});
});
