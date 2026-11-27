import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";

import { readPluginArchive } from "./external-plugin-archive.js";

const limits = { maxFiles: 10, maxBytes: 1024 };

function zip(files: Record<string, string>): Uint8Array {
	const entries: Zippable = {};
	for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
	return zipSync(entries);
}

function names(files: ReadonlyMap<string, Uint8Array>): string[] {
	return [...files.keys()].sort();
}

describe("readPluginArchive", () => {
	it("reads a plugin zipped from inside its folder", () => {
		const files = readPluginArchive(
			zip({ "plugin.json": "{}", "dist/web.js": "export default {};" }),
			limits,
		);

		expect(names(files)).toEqual(["dist/web.js", "plugin.json"]);
		expect(new TextDecoder().decode(files.get("dist/web.js"))).toBe("export default {};");
	});

	it("unwraps a plugin zipped as its folder, ignoring macOS metadata", () => {
		const files = readPluginArchive(
			zip({
				"right-panel/plugin.json": "{}",
				"right-panel/web.js": "",
				"__MACOSX/right-panel/._web.js": "",
				"right-panel/.DS_Store": "",
			}),
			limits,
		);

		expect(names(files)).toEqual(["plugin.json", "web.js"]);
	});

	it("leaves out folders the scanner ignores", () => {
		const files = readPluginArchive(
			zip({ "plugin.json": "{}", "node_modules/dep/index.js": "", ".git/HEAD": "" }),
			limits,
		);

		expect(names(files)).toEqual(["plugin.json"]);
	});

	it.each([
		["isn't a zip file", strToU8("not a zip"), /isn't a zip/],
		["has no plugin.json", zip({ "web.js": "" }), /plugin\.json/],
		[
			"has entries that escape its folder",
			zip({ "plugin.json": "{}", "../evil.js": "" }),
			/outside/,
		],
		["has absolute entries", zip({ "plugin.json": "{}", "/etc/evil.js": "" }), /outside/],
		[
			"has too many files",
			zip(Object.fromEntries([...Array(12).keys()].map((i) => [`f${i}.js`, ""]))),
			/too large/,
		],
		["unpacks too large", zip({ "plugin.json": "{}", "big.js": "x".repeat(2048) }), /too large/],
	])("refuses an archive that %s", (_case, archive, message) => {
		expect(() => readPluginArchive(archive, limits)).toThrow(message);
	});
});
