import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { kiloInlineConfigContent } from "./kilo-inline-config.js";

const ARCHIVE_COMMANDS_ASK = {
	"bash*": { "tar *": "ask", "unzip *": "ask", "gzip *": "ask", "gunzip *": "ask" },
};

describe("Kilo inline config", () => {
	it("passes plugins to Kilo as file URLs alongside the pinned indexing base", () => {
		const file = path.join("/tmp", "kilo plugins", "anaconda-notebooks.js");

		expect(JSON.parse(kiloInlineConfigContent([file], "https://api.kilo.ai"))).toEqual({
			indexing: { kilo: { baseUrl: "https://api.kilo.ai" } },
			permission: ARCHIVE_COMMANDS_ASK,
			plugin: [pathToFileURL(file).href],
		});
	});

	it("pins the kilo indexing base even when there are no managed plugin files", () => {
		expect(JSON.parse(kiloInlineConfigContent([], "https://api.kilo.ai"))).toEqual({
			indexing: { kilo: { baseUrl: "https://api.kilo.ai" } },
			permission: ARCHIVE_COMMANDS_ASK,
		});
	});

	it("flows the base URL into the indexing pin unchanged", () => {
		expect(
			JSON.parse(kiloInlineConfigContent([], "http://127.0.0.1:4999")).indexing.kilo.baseUrl,
		).toBe("http://127.0.0.1:4999");
	});
});
