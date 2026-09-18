import { describe, expect, it } from "vitest";

import type { PluginDeepLink } from "@kilo-desktop/feature-sdk";

import { findDesktopDeepLink, parseDesktopDeepLink } from "./desktop-deep-link.js";

const catalogLink: PluginDeepLink = {
	host: "model-catalog",
	to: "/settings/local-model-server",
	searchParam: "catalogModel",
};

describe("parseDesktopDeepLink", () => {
	it("parses a production contributed URL", () => {
		expect(
			parseDesktopDeepLink("kilo-desktop://model-catalog/48d448b0-2634-4c32-b3fe-56a26483c904", [
				catalogLink,
			]),
		).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "48d448b0-2634-4c32-b3fe-56a26483c904" },
		});
	});

	it("parses a development scheme URL and a trailing slash", () => {
		expect(
			parseDesktopDeepLink("kilo-desktop-dev://model-catalog/catalog-model/", [catalogLink]),
		).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
	});

	it("decodes a percent-encoded path segment", () => {
		expect(parseDesktopDeepLink("kilo-desktop://model-catalog/model%2Did", [catalogLink])).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "model-id" },
		});
	});

	it("matches a mixed-case host", () => {
		expect(
			parseDesktopDeepLink("kilo-desktop://Model-Catalog/catalog-model", [catalogLink]),
		).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
	});

	it("ignores hosts no plugin contributed", () => {
		expect(parseDesktopDeepLink("kilo-desktop://model-catalog/catalog-model", [])).toBeUndefined();
	});

	it.each([
		"https://model-catalog/abc",
		"kilo-desktop://app/#/settings/local-model-server",
		"kilo-desktop://evil/abc",
		"kilo-desktop://model-catalog/",
		"kilo-desktop://model-catalog",
		"kilo-desktop://model-catalog/a/b",
		"kilo-desktop://model-catalog/..",
		"kilo-desktop://model-catalog/%2e%2e",
		"kilo-desktop://model-catalog/%2fetc",
		"kilo-desktop://user@model-catalog/abc",
		"kilo-desktop://model-catalog:443/abc",
		"not a url",
	])("rejects %s", (url) => {
		expect(parseDesktopDeepLink(url, [catalogLink])).toBeUndefined();
	});
});

describe("findDesktopDeepLink", () => {
	it("returns the first argv deep link and ignores other arguments", () => {
		expect(
			findDesktopDeepLink(
				[
					"/usr/bin/kilo-desktop",
					"--allow-file-access-from-files",
					"kilo-desktop://model-catalog/catalog-model",
				],
				[catalogLink],
			),
		).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
	});

	it("returns undefined when argv has no deep link", () => {
		expect(
			findDesktopDeepLink(["/usr/bin/kilo-desktop", "--hidden"], [catalogLink]),
		).toBeUndefined();
	});
});
