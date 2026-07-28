import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { isTrustedRendererUrl } from "./ElectronSecurity.js";

describe("ElectronSecurity", () => {
	it.each([
		"anaconda-agentic-desktop://app/",
		"anaconda-agentic-desktop://app/settings/",
		"anaconda-agentic-desktop-dev://app/",
	])("trusts renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(true);
	});

	it.each([
		"https://app/",
		"anaconda-agentic-desktop://evil/",
		"file:///tmp/index.html",
		"javascript:alert(1)",
	])("rejects renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(false);
	});
});
