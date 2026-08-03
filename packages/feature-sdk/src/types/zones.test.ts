import { describe, expect, it } from "vitest";

import {
	DASHBOARD_ZONE,
	isShellZone,
	SHELL_ZONES,
	SIDEBAR_ZONE,
	STATUS_BAR_ZONE,
} from "./zones.js";

describe("shell zones (Decision #21)", () => {
	it("exposes the canonical kebab-case zone ids", () => {
		expect(SHELL_ZONES).toEqual(["sidebar", "status-bar", "dashboard"]);
		expect(SIDEBAR_ZONE).toBe("sidebar");
		expect(STATUS_BAR_ZONE).toBe("status-bar");
		expect(DASHBOARD_ZONE).toBe("dashboard");
	});

	it("isShellZone accepts canonical ids and rejects drifted ones", () => {
		expect(isShellZone("status-bar")).toBe(true);
		expect(isShellZone("sidebar")).toBe(true);
		expect(isShellZone("dashboard")).toBe(true);
		// The historical drift this union exists to prevent:
		expect(isShellZone("statusbar")).toBe(false);
		expect(isShellZone("")).toBe(false);
	});
});
