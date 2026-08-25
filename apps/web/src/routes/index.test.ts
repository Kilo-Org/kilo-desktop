import { describe, expect, it } from "vitest";

import { deriveHomeSplat } from "@/features/home-route";

describe("deriveHomeSplat", () => {
	it("strips the leading slash from the contributed route path", () => {
		expect(deriveHomeSplat("/chat")).toBe("chat");
		expect(deriveHomeSplat("/chat/history")).toBe("chat/history");
	});

	it("throws when the plugin declares no contributed route", () => {
		expect(() => deriveHomeSplat(undefined)).toThrow(/must declare at least one contributed route/);
	});
});
