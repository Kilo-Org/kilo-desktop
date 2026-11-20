import { describe, expect, it } from "vitest";

import { normalizeWorkspaceIdentityColor } from "./identity-color";

describe("workspace identity color", () => {
	it("normalizes hex colors to #RRGGBB", () => {
		expect(normalizeWorkspaceIdentityColor("#5ea0f7")).toBe("#5EA0F7");
		expect(normalizeWorkspaceIdentityColor("  #34d  ")).toBe("#3344DD");
		expect(normalizeWorkspaceIdentityColor("#F87")).toBe("#FF8877");
	});

	it("rejects missing or invalid colors", () => {
		expect(normalizeWorkspaceIdentityColor(undefined)).toBeNull();
		expect(normalizeWorkspaceIdentityColor(null)).toBeNull();
		expect(normalizeWorkspaceIdentityColor("")).toBeNull();
		expect(normalizeWorkspaceIdentityColor("blue")).toBeNull();
		expect(normalizeWorkspaceIdentityColor("#12")).toBeNull();
		expect(normalizeWorkspaceIdentityColor("#12345")).toBeNull();
	});
});
