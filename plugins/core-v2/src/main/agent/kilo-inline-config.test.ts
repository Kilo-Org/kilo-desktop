import { describe, expect, it } from "vitest";

import { kiloInlineConfigContent } from "./kilo-inline-config.js";

describe("Kilo inline config", () => {
	it("makes archive commands ask through v2 shell permission rules", () => {
		expect(JSON.parse(kiloInlineConfigContent())).toEqual({
			permissions: [
				{ action: "shell", resource: "tar *", effect: "ask" },
				{ action: "shell", resource: "unzip *", effect: "ask" },
				{ action: "shell", resource: "gzip *", effect: "ask" },
				{ action: "shell", resource: "gunzip *", effect: "ask" },
			],
		});
	});

	it("uses no v1 keys, which v2 would migrate under names it no longer matches", () => {
		const config = JSON.parse(kiloInlineConfigContent()) as Record<string, unknown>;
		expect(Object.keys(config)).toEqual(["permissions"]);
	});
});
