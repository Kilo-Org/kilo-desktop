import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWebMcpRelayEntry, translateAsarPath } from "./webmcp-relay-entry.js";

// Build fixture paths with `path.join` so they are platform-native (backslash
// on Windows, forward slash elsewhere). `require.resolve` returns platform-
// native paths in production, so tests must match that.
function nativePath(...segments: string[]): string {
	return path.join(path.sep, ...segments);
}

describe("translateAsarPath", () => {
	it("rewrites .../app.asar/... to .../app.asar.unpacked/... for packaged builds", () => {
		const packagedPath = nativePath(
			"Applications",
			"App.app",
			"Contents",
			"Resources",
			"app.asar",
			"node_modules",
			"@mcp-b",
			"webmcp-local-relay",
			"dist",
			"cli.mjs",
		);
		const expected = nativePath(
			"Applications",
			"App.app",
			"Contents",
			"Resources",
			"app.asar.unpacked",
			"node_modules",
			"@mcp-b",
			"webmcp-local-relay",
			"dist",
			"cli.mjs",
		);
		expect(translateAsarPath(packagedPath)).toBe(expected);
	});

	it("is identity for paths without an app.asar segment (dev / test)", () => {
		const devPath = nativePath(
			"repo",
			"node_modules",
			"@mcp-b",
			"webmcp-local-relay",
			"dist",
			"cli.mjs",
		);
		expect(translateAsarPath(devPath)).toBe(devPath);
	});

	it("does not touch a substring that is not a directory segment", () => {
		// Defensive: a hypothetical file literally named 'foo.app.asar.js' is
		// not the asar bundle marker; we only match the exact segment.
		const oddPath = nativePath("repo", "some.app.asar.js");
		expect(translateAsarPath(oddPath)).toBe(oddPath);
	});
});

describe("resolveWebMcpRelayEntry", () => {
	const devMainEntry = nativePath(
		"repo",
		"node_modules",
		"@mcp-b",
		"webmcp-local-relay",
		"dist",
		"index.mjs",
	);
	const devCliEntry = nativePath(
		"repo",
		"node_modules",
		"@mcp-b",
		"webmcp-local-relay",
		"dist",
		"cli.mjs",
	);

	it("returns the absolute bin path and package version", () => {
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () => devMainEntry,
			readPackageJson: () => ({
				version: "4.0.0",
				bin: { "webmcp-local-relay": "./dist/cli.mjs" },
			}),
		});
		expect(resolved).toEqual({ entry: devCliEntry, version: "4.0.0" });
	});

	it("supports the string form of the bin field", () => {
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () => devMainEntry,
			readPackageJson: () => ({ version: "4.0.0", bin: "./dist/cli.mjs" }),
		});
		expect(resolved.entry).toBe(devCliEntry);
	});

	it("rewrites asar-embedded paths to the unpacked location", () => {
		const packagedMainEntry = nativePath(
			"App",
			"Contents",
			"Resources",
			"app.asar",
			"node_modules",
			"@mcp-b",
			"webmcp-local-relay",
			"dist",
			"index.mjs",
		);
		const expectedCliEntry = nativePath(
			"App",
			"Contents",
			"Resources",
			"app.asar.unpacked",
			"node_modules",
			"@mcp-b",
			"webmcp-local-relay",
			"dist",
			"cli.mjs",
		);
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () => packagedMainEntry,
			readPackageJson: () => ({
				version: "4.0.0",
				bin: { "webmcp-local-relay": "./dist/cli.mjs" },
			}),
		});
		expect(resolved.entry).toBe(expectedCliEntry);
	});

	it("throws a helpful error when the package cannot be resolved", () => {
		expect(() =>
			resolveWebMcpRelayEntry({
				requireResolve: () => {
					throw new Error("MODULE_NOT_FOUND");
				},
				readPackageJson: () => ({ version: "4.0.0", bin: "./dist/cli.mjs" }),
			}),
		).toThrow(/Failed to resolve @mcp-b\/webmcp-local-relay/);
	});

	it("throws when the bin field is missing", () => {
		expect(() =>
			resolveWebMcpRelayEntry({
				requireResolve: () => devMainEntry,
				readPackageJson: () => ({ version: "4.0.0" }),
			}),
		).toThrow(/does not declare an expected 'bin' entry/);
	});

	it("resolves against the real installed package in this workspace", () => {
		// Smoke test: the dep is installed, its bin should resolve without stubs.
		const resolved = resolveWebMcpRelayEntry();
		expect(resolved.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(resolved.entry).toMatch(/webmcp-local-relay[\\/]dist[\\/]cli\.mjs$/);
	});
});
