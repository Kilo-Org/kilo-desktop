import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { externalizeDeps } from "./index.js";

function resolveExternal(options: Parameters<typeof externalizeDeps>[0]): Array<string | RegExp> {
	const plugin = externalizeDeps(options);
	const hook = plugin.config;
	const run = typeof hook === "function" ? hook : hook?.handler;
	const result = run?.call(
		{} as never,
		{} as never,
		{ command: "build", mode: "production" } as never,
	);
	const config = result as { build?: { rollupOptions?: { external?: unknown } } } | undefined;
	return (config?.build?.rollupOptions?.external ?? []) as Array<string | RegExp>;
}

function isExternal(external: Array<string | RegExp>, id: string): boolean {
	return external.some((matcher) =>
		typeof matcher === "string" ? matcher === id : matcher.test(id),
	);
}

describe("externalizeDeps", () => {
	let directory: string;
	let packageJsonPath: string;

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), "externalize-deps-"));
		packageJsonPath = path.join(directory, "package.json");
		writeFileSync(
			packageJsonPath,
			JSON.stringify({
				dependencies: {
					"@github/keytar": "^7.10.6",
					execa: "^9.6.0",
					"@anaconda-agentic-desktop/plugin-kilo-ui": "workspace:*",
				},
				optionalDependencies: { "optional-dep": "^1.0.0" },
				peerDependencies: { "peer-dep": "^1.0.0" },
			}),
		);
	});

	afterEach(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	it("externalizes dependencies and their subpaths", () => {
		const external = resolveExternal({ packageJsonPath });

		expect(isExternal(external, "execa")).toBe(true);
		expect(isExternal(external, "@github/keytar")).toBe(true);
		expect(isExternal(external, "@github/keytar/lib/keytar.js")).toBe(true);
		expect(isExternal(external, "unlisted-dep")).toBe(false);
	});

	it("externalizes optional and peer dependencies", () => {
		const external = resolveExternal({ packageJsonPath });

		expect(isExternal(external, "optional-dep")).toBe(true);
		expect(isExternal(external, "peer-dep")).toBe(true);
	});

	it("externalizes Node built-ins with and without the node: prefix", () => {
		const external = resolveExternal({ packageJsonPath });

		expect(isExternal(external, "path")).toBe(true);
		expect(isExternal(external, "node:path")).toBe(true);
		expect(isExternal(external, "not-a-builtin")).toBe(false);
	});

	it("omits Node built-ins when nodeBuiltins is false", () => {
		const external = resolveExternal({ packageJsonPath, nodeBuiltins: false });

		expect(isExternal(external, "path")).toBe(false);
		expect(isExternal(external, "execa")).toBe(true);
	});

	it("keeps excluded dependencies bundled", () => {
		const external = resolveExternal({
			packageJsonPath,
			exclude: [/^@anaconda-agentic-desktop\/.+$/],
		});

		expect(isExternal(external, "@anaconda-agentic-desktop/plugin-kilo-ui")).toBe(false);
		expect(isExternal(external, "execa")).toBe(true);
	});

	it("adds included externals not present in package.json", () => {
		const external = resolveExternal({
			packageJsonPath,
			include: ["electron", /^better-sqlite3(?:\/.+)?$/],
		});

		expect(isExternal(external, "electron")).toBe(true);
		expect(isExternal(external, "better-sqlite3")).toBe(true);
		expect(isExternal(external, "better-sqlite3/build/Release/x.node")).toBe(true);
	});

	it("emits an array of string | RegExp, never a function", () => {
		const external = resolveExternal({ packageJsonPath, include: ["electron"] });

		expect(Array.isArray(external)).toBe(true);
		for (const matcher of external) {
			expect(typeof matcher === "string" || matcher instanceof RegExp).toBe(true);
		}
	});
});
