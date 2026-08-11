import { describe, expect, it } from "vitest";

import {
	DASHBOARD_ZONE,
	HEADER_LEADING_ZONE,
	HEADER_TRAILING_ZONE,
	HOME_COMPOSER_LEADING_ACTION_ZONE,
	isShellZone,
	SHELL_ZONES,
	SIDEBAR_ZONE,
	STATUS_BAR_ZONE,
} from "./zones.js";

describe("shell zones (Decision #21)", () => {
	it("exposes the canonical kebab-case zone ids", () => {
		expect(SHELL_ZONES).toEqual([
			"sidebar",
			"status-bar",
			"dashboard",
			"home-composer-leading-action",
			"header-leading",
			"header-trailing",
		]);
		expect(SIDEBAR_ZONE).toBe("sidebar");
		expect(STATUS_BAR_ZONE).toBe("status-bar");
		expect(DASHBOARD_ZONE).toBe("dashboard");
		expect(HOME_COMPOSER_LEADING_ACTION_ZONE).toBe("home-composer-leading-action");
		expect(HEADER_LEADING_ZONE).toBe("header-leading");
		expect(HEADER_TRAILING_ZONE).toBe("header-trailing");
	});

	it("isShellZone accepts canonical ids and rejects drifted ones", () => {
		expect(isShellZone("status-bar")).toBe(true);
		expect(isShellZone("sidebar")).toBe(true);
		expect(isShellZone("dashboard")).toBe(true);
		expect(isShellZone("home-composer-leading-action")).toBe(true);
		expect(isShellZone("header-leading")).toBe(true);
		expect(isShellZone("header-trailing")).toBe(true);
		// The historical drift this union exists to prevent:
		expect(isShellZone("statusbar")).toBe(false);
		expect(isShellZone("")).toBe(false);
	});
});
