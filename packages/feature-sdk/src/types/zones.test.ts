import { describe, expect, it } from "vitest";

import {
	DASHBOARD_ZONE,
	isShellZone,
	PAGE_HEADER_ACTIONS_ZONE,
	SHELL_ZONES,
	SIDEBAR_ACCOUNT_ZONE,
	SIDEBAR_HEADER_ACTIONS_ZONE,
	SIDEBAR_ZONE,
	STATUS_BAR_ZONE,
} from "./zones.js";

describe("shell zones (Decision #21)", () => {
	it("exposes the canonical kebab-case zone ids", () => {
		expect(SHELL_ZONES).toEqual([
			"sidebar",
			"sidebar-account",
			"sidebar-header-actions",
			"status-bar",
			"dashboard",
			"page-header-actions",
		]);
		expect(SIDEBAR_ZONE).toBe("sidebar");
		expect(SIDEBAR_ACCOUNT_ZONE).toBe("sidebar-account");
		expect(SIDEBAR_HEADER_ACTIONS_ZONE).toBe("sidebar-header-actions");
		expect(STATUS_BAR_ZONE).toBe("status-bar");
		expect(DASHBOARD_ZONE).toBe("dashboard");
		expect(PAGE_HEADER_ACTIONS_ZONE).toBe("page-header-actions");
	});

	it("isShellZone accepts canonical ids and rejects drifted ones", () => {
		expect(isShellZone("sidebar-header-actions")).toBe(true);
		expect(isShellZone("sidebar-account")).toBe(true);
		expect(isShellZone("status-bar")).toBe(true);
		expect(isShellZone("sidebar")).toBe(true);
		expect(isShellZone("dashboard")).toBe(true);
		expect(isShellZone("page-header-actions")).toBe(true);
		expect(isShellZone("header-leading")).toBe(false);
		expect(isShellZone("header-trailing")).toBe(false);
		// The historical drift this union exists to prevent:
		expect(isShellZone("statusbar")).toBe(false);
		expect(isShellZone("")).toBe(false);
	});
});
