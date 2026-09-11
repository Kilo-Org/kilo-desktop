import { describe, expect, it } from "vitest";

import { parseActionEntries, parseTransactionActions } from "./transaction-actions.js";

describe("parseActionEntries", () => {
	it("splits channel/subdir, name, version, and drops the build string", () => {
		expect(
			parseActionEntries([
				"defaults/osx-arm64::mcp==2.0.0=py311hca03da5_0",
				"conda-forge/noarch::attrs==25.4.0=pyhcf101f3_1",
			]),
		).toEqual([
			{ name: "mcp", version: "2.0.0", channel: "defaults/osx-arm64" },
			{ name: "attrs", version: "25.4.0", channel: "conda-forge/noarch" },
		]);
	});

	it("accepts entries without a channel prefix or build string", () => {
		expect(parseActionEntries(["numpy==2.1.0"])).toEqual([
			{ name: "numpy", version: "2.1.0", channel: "" },
		]);
	});

	it("returns an empty list for non-array input", () => {
		expect(parseActionEntries(undefined)).toEqual([]);
		expect(parseActionEntries("defaults::numpy==1.0=0")).toEqual([]);
		expect(parseActionEntries({ LINK: [] })).toEqual([]);
	});

	it("skips malformed entries that lack a name==version core", () => {
		expect(parseActionEntries(["defaults::numpy-1.0-py_0", "::==1.0=0", 42, "pkg==1.0=0"])).toEqual(
			[{ name: "pkg", version: "1.0", channel: "" }],
		);
	});
});

describe("parseTransactionActions", () => {
	const link = (spec: string) => `defaults/osx-arm64::${spec}`;

	it("classifies a same-name LINK/UNLINK pair by version direction", () => {
		const result = parseTransactionActions({
			LINK: [link("numpy==2.1.0=py311_0"), link("pandas==1.5.0=py311_0")],
			UNLINK: [link("numpy==2.0.0=py311_0"), link("pandas==2.2.0=py311_0")],
		});

		expect(result.upgraded).toEqual([
			{ name: "numpy", fromVersion: "2.0.0", toVersion: "2.1.0", channel: "defaults/osx-arm64" },
		]);
		expect(result.downgraded).toEqual([
			{ name: "pandas", fromVersion: "2.2.0", toVersion: "1.5.0", channel: "defaults/osx-arm64" },
		]);
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([]);
		expect(result.rebuilt).toEqual([]);
		expect(result.nothingToDo).toBe(false);
	});

	it("classifies a same-version relink as rebuilt and reports the new channel", () => {
		const result = parseTransactionActions({
			LINK: ["conda-forge/noarch::attrs==25.4.0=pyhcf101f3_1"],
			UNLINK: ["defaults/noarch::attrs==25.4.0=py_0"],
		});

		expect(result.rebuilt).toEqual([
			{ name: "attrs", fromVersion: "25.4.0", toVersion: "25.4.0", channel: "conda-forge/noarch" },
		]);
		expect(result.upgraded).toEqual([]);
		expect(result.downgraded).toEqual([]);
	});

	it("reports LINK-only names as added and UNLINK-only names as removed", () => {
		const result = parseTransactionActions({
			LINK: [link("libffi==3.4.8=h0_0")],
			UNLINK: [link("six==1.16.0=py_0")],
		});

		expect(result.added).toEqual([
			{ name: "libffi", fromVersion: null, toVersion: "3.4.8", channel: "defaults/osx-arm64" },
		]);
		expect(result.removed).toEqual([
			{ name: "six", fromVersion: "1.16.0", toVersion: null, channel: "defaults/osx-arm64" },
		]);
		expect(result.nothingToDo).toBe(false);
	});

	it("orders numeric version components numerically when classifying", () => {
		// Lexical comparison would call 1.10 < 1.9 a downgrade.
		const result = parseTransactionActions({
			LINK: [link("pkg==1.10.0=0")],
			UNLINK: [link("pkg==1.9.0=0")],
		});
		expect(result.upgraded).toHaveLength(1);
		expect(result.downgraded).toHaveLength(0);
	});

	it("reports nothingToDo when both action groups are empty or missing", () => {
		expect(parseTransactionActions({}).nothingToDo).toBe(true);
		expect(parseTransactionActions({ LINK: [], UNLINK: [] }).nothingToDo).toBe(true);
		// Other legacy groups (FETCH, EXTRACT, PREFIX) do not count as changes.
		expect(
			parseTransactionActions({ FETCH: [link("numpy==2.1.0=0")], PREFIX: "/env" }).nothingToDo,
		).toBe(true);
	});
});
