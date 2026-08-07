import { describe, expect, it } from "vitest";

import { resolveWebMcpRelayEntry, translateAsarPath } from "./webmcp-relay-entry.js";

describe("translateAsarPath", () => {
	it("rewrites .../app.asar/... to .../app.asar.unpacked/... for packaged builds", () => {
		const packagedPath =
			"/Applications/App.app/Contents/Resources/app.asar/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs";
		const rewritten = translateAsarPath(packagedPath);
		expect(rewritten).toBe(
			"/Applications/App.app/Contents/Resources/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs",
		);
	});

	it("is identity for paths without an app.asar segment (dev / test)", () => {
		const devPath = "/repo/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs";
		expect(translateAsarPath(devPath)).toBe(devPath);
	});

	it("does not touch a substring that is not a directory segment", () => {
		// Defensive: a hypothetical file literally named 'foo.app.asar.js' is
		// not the asar bundle marker; we only match the exact segment.
		const oddPath = "/repo/some.app.asar.js";
		expect(translateAsarPath(oddPath)).toBe(oddPath);
	});
});

describe("resolveWebMcpRelayEntry", () => {
	it("returns the absolute bin path and package version", () => {
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () => "/repo/node_modules/@mcp-b/webmcp-local-relay/dist/index.mjs",
			readPackageJson: () => ({
				version: "4.0.0",
				bin: { "webmcp-local-relay": "./dist/cli.mjs" },
			}),
		});
		expect(resolved).toEqual({
			entry: "/repo/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs",
			version: "4.0.0",
		});
	});

	it("supports the string form of the bin field", () => {
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () => "/repo/node_modules/@mcp-b/webmcp-local-relay/dist/index.mjs",
			readPackageJson: () => ({
				version: "4.0.0",
				bin: "./dist/cli.mjs",
			}),
		});
		expect(resolved.entry).toBe("/repo/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs");
	});

	it("rewrites asar-embedded paths to the unpacked location", () => {
		const resolved = resolveWebMcpRelayEntry({
			requireResolve: () =>
				"/App/Contents/Resources/app.asar/node_modules/@mcp-b/webmcp-local-relay/dist/index.mjs",
			readPackageJson: () => ({
				version: "4.0.0",
				bin: { "webmcp-local-relay": "./dist/cli.mjs" },
			}),
		});
		expect(resolved.entry).toBe(
			"/App/Contents/Resources/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs",
		);
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
				requireResolve: () => "/repo/node_modules/@mcp-b/webmcp-local-relay/dist/index.mjs",
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
