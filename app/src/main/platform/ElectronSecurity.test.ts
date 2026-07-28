import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { isTrustedRendererUrl } from "./ElectronSecurity.js";

describe("ElectronSecurity", () => {
	it.each([
		"anaconda-desktop://app/",
		"anaconda-desktop://app/settings/",
		"anaconda-desktop-dev://app/",
	])("trusts renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(true);
	});

	it.each([
		"https://app/",
		"anaconda-desktop://evil/",
		"file:///tmp/index.html",
		"javascript:alert(1)",
	])("rejects renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(false);
	});
});
