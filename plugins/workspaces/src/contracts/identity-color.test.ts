import { describe, expect, it } from "vitest";

import {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	WORKSPACE_IDENTITY_COLORS,
} from "./identity-color";

describe("workspace identity color", () => {
	it("exposes the workspace identity color presets", () => {
		expect(WORKSPACE_IDENTITY_COLORS).toEqual([
			"#5EA0F7",
			"#34D399",
			"#F87171",
			"#A78BFA",
			"#22D3EE",
			"#FBBF24",
		]);
		expect(DEFAULT_WORKSPACE_IDENTITY_COLOR).toBe("#5EA0F7");
	});

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
