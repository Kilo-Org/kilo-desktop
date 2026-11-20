import { describe, expect, it } from "vitest";

import {
	SERVER_LINE_PACKAGES,
	serverLineAliases,
	serverLineOf,
	serverLinePackage,
} from "./server-line";

describe("serverLineOf", () => {
	it("builds the v1 line when the variable is unset or empty", () => {
		expect(serverLineOf({})).toBe("v1");
		expect(serverLineOf({ KILO_SERVER_LINE: "" })).toBe("v1");
	});

	it("reads v1 and v2", () => {
		expect(serverLineOf({ KILO_SERVER_LINE: "v1" })).toBe("v1");
		expect(serverLineOf({ KILO_SERVER_LINE: "v2" })).toBe("v2");
	});

	it("fails the build on an unknown line", () => {
		expect(() => serverLineOf({ KILO_SERVER_LINE: "v3" })).toThrow(/KILO_SERVER_LINE.*v3/);
	});
});

describe("serverLinePackage", () => {
	it("keeps v1 packages on the v1 line", () => {
		for (const name of Object.keys(SERVER_LINE_PACKAGES)) {
			expect(serverLinePackage("v1", name)).toBe(name);
		}
	});

	it("passes through packages that don't differ per line", () => {
		expect(serverLinePackage("v2", "@kilo-desktop/plugin-git")).toBe("@kilo-desktop/plugin-git");
	});
});

describe("serverLineAliases", () => {
	it("aliases nothing on the v1 line", () => {
		expect(serverLineAliases("v1")).toEqual([]);
	});

	it("aliases only the entry subpaths of packages whose v2 copy exists", () => {
		const aliases = serverLineAliases("v2", {
			"@kilo-desktop/plugin-core": {
				v1: "@kilo-desktop/plugin-core",
				v2: "@kilo-desktop/plugin-core-v2",
			},
			"@kilo-desktop/plugin-chat": {
				v1: "@kilo-desktop/plugin-chat",
				v2: "@kilo-desktop/plugin-chat",
			},
		});

		const resolve = (specifier: string) => {
			const alias = aliases.find(({ find }) => find.test(specifier));
			return alias ? specifier.replace(alias.find, alias.replacement) : specifier;
		};
		expect(resolve("@kilo-desktop/plugin-core/main")).toBe("@kilo-desktop/plugin-core-v2/main");
		expect(resolve("@kilo-desktop/plugin-core/web")).toBe("@kilo-desktop/plugin-core-v2/web");
		expect(resolve("@kilo-desktop/plugin-core/plugin.json")).toBe(
			"@kilo-desktop/plugin-core-v2/plugin.json",
		);
		// The v2 copy re-exports the v1 contracts, so contracts must keep
		// resolving to the v1 package (an alias here would import itself).
		expect(resolve("@kilo-desktop/plugin-core/contracts")).toBe(
			"@kilo-desktop/plugin-core/contracts",
		);
		expect(resolve("@kilo-desktop/plugin-core-v2/main")).toBe("@kilo-desktop/plugin-core-v2/main");
		expect(resolve("@kilo-desktop/plugin-chat/main")).toBe("@kilo-desktop/plugin-chat/main");
	});
});
