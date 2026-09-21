import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	getNativeInventory,
	getPayloadPackageName,
	isBridgePayloadManifest,
	readStagedManifest,
	type BridgePayloadManifest,
} from "./bridge-artifacts.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "manifest-test-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * A structurally complete manifest. `target` mirrors the real payload's
 * convention (the published darwin package reports `macos-arm64`, not
 * `darwin-arm64`) — it is informational metadata and no code here consumes it.
 */
function manifestFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 1,
		target: "macos-arm64",
		python_version: "3.11.12",
		bridge_version: "0.1.7",
		launch: ["python/bin/python3.11", "-E", "-s", "-m", "anaconda_desktop_bridge"],
		packages: {},
		natives: ["python/bin/python3.11", "lib/libssl.dylib"],
		...overrides,
	};
}

function writeManifest(dir: string, manifest: unknown): void {
	writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

describe("getPayloadPackageName", () => {
	it("returns the darwin-arm64 package", () => {
		expect(getPayloadPackageName("darwin", "arm64")).toBe(
			"@anaconda/desktop-bridge-payload-darwin-arm64",
		);
	});

	it("returns the win32-x64 package", () => {
		expect(getPayloadPackageName("win32", "x64")).toBe(
			"@anaconda/desktop-bridge-payload-win32-x64",
		);
	});

	it("returns the linux-x64 package", () => {
		expect(getPayloadPackageName("linux", "x64")).toBe(
			"@anaconda/desktop-bridge-payload-linux-x64",
		);
	});

	it("returns null for unsupported platform/arch", () => {
		expect(getPayloadPackageName("darwin", "x64")).toBeNull();
		expect(getPayloadPackageName("linux", "arm64")).toBeNull();
		expect(getPayloadPackageName("win32", "arm64")).toBeNull();
		expect(getPayloadPackageName("freebsd" as NodeJS.Platform, "x64")).toBeNull();
	});
});

describe("getNativeInventory", () => {
	it("prefers natives when present", () => {
		const manifest = manifestFixture({
			natives: ["a", "b"],
			macho: ["stale"],
		}) as unknown as BridgePayloadManifest;
		expect(getNativeInventory(manifest)).toEqual(["a", "b"]);
	});

	it("falls back to macho when natives is absent", () => {
		// The pre-rename payload shape: macOS-only, `macho` and no `natives`.
		// This is the case the fallback in stage-bridge exists for.
		const manifest = manifestFixture({
			natives: undefined,
			macho: ["python/bin/python3.11"],
		}) as unknown as BridgePayloadManifest;
		expect(getNativeInventory(manifest)).toEqual(["python/bin/python3.11"]);
	});

	it("returns an empty array when neither field is present", () => {
		const manifest = manifestFixture({
			natives: undefined,
		}) as unknown as BridgePayloadManifest;
		expect(getNativeInventory(manifest)).toEqual([]);
	});
});

describe("isBridgePayloadManifest", () => {
	it("accepts a complete manifest", () => {
		expect(isBridgePayloadManifest(manifestFixture())).toBe(true);
	});

	it("accepts a manifest carrying only the legacy macho field", () => {
		expect(isBridgePayloadManifest(manifestFixture({ natives: undefined, macho: ["x"] }))).toBe(
			true,
		);
	});

	it("rejects non-objects", () => {
		expect(isBridgePayloadManifest(null)).toBe(false);
		expect(isBridgePayloadManifest("{}")).toBe(false);
		expect(isBridgePayloadManifest(42)).toBe(false);
	});

	it("rejects a manifest missing required fields", () => {
		expect(isBridgePayloadManifest(manifestFixture({ bridge_version: undefined }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ launch: undefined }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ schema: "1" }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ packages: undefined }))).toBe(false);
	});

	it("rejects a manifest whose inventory fields are not string arrays", () => {
		expect(isBridgePayloadManifest(manifestFixture({ natives: "lib/libssl.dylib" }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ natives: [1, 2] }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ macho: {} }))).toBe(false);
	});

	it("rejects a manifest whose packages field is not a string record", () => {
		// `typeof [] === "object"` and arrays are non-null, so a bare typeof check
		// would let an array satisfy a Record<string, string> field.
		expect(isBridgePayloadManifest(manifestFixture({ packages: ["numpy"] }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ packages: { numpy: 2 } }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ packages: "numpy=2" }))).toBe(false);
		expect(isBridgePayloadManifest(manifestFixture({ packages: { numpy: "2.1.0" } }))).toBe(true);
	});

	it("rejects a manifest whose launch array holds non-strings", () => {
		expect(isBridgePayloadManifest(manifestFixture({ launch: ["python", 3] }))).toBe(false);
	});
});

describe("readStagedManifest", () => {
	it("reads a valid manifest with the natives field", () => {
		const dir = makeTempDir();
		writeManifest(dir, manifestFixture({ target: "linux-x64", natives: ["lib/libssl.so"] }));

		const manifest = readStagedManifest(dir);
		expect(manifest).not.toBeNull();
		expect(manifest!.natives).toEqual(["lib/libssl.so"]);
		expect(manifest!.macho).toBeUndefined();
	});

	it("reads a legacy manifest that carries macho but not natives", () => {
		const dir = makeTempDir();
		writeManifest(dir, manifestFixture({ natives: undefined, macho: ["python/bin/python3.11"] }));

		const manifest = readStagedManifest(dir);
		expect(manifest).not.toBeNull();
		expect(manifest!.natives).toBeUndefined();
		expect(manifest!.macho).toEqual(["python/bin/python3.11"]);
		expect(getNativeInventory(manifest!)).toEqual(["python/bin/python3.11"]);
	});

	it("reads a current manifest that carries both fields", () => {
		// What the published 0.1.7 payloads actually ship.
		const dir = makeTempDir();
		writeManifest(dir, manifestFixture({ natives: ["a"], macho: ["a"] }));

		const manifest = readStagedManifest(dir);
		expect(getNativeInventory(manifest!)).toEqual(["a"]);
	});

	it("returns null when directory does not exist", () => {
		expect(readStagedManifest("/nonexistent/path")).toBeNull();
	});

	it("returns null when the manifest is not valid JSON", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, "manifest.json"), "{ not json");
		expect(readStagedManifest(dir)).toBeNull();
	});

	it("returns null when the manifest parses but is malformed", () => {
		const dir = makeTempDir();
		writeManifest(dir, manifestFixture({ launch: undefined }));
		expect(readStagedManifest(dir)).toBeNull();
	});
});
