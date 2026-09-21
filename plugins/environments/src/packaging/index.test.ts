import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getPayloadPackageName } from "./bridge-artifacts.js";
import { createBridgePackagingPlan } from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pkg-plan-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * Override the host platform/arch that cross-build detection compares against,
 * so the assertion holds on every runner. Returns a restore function;
 * `process.platform` and `process.arch` are configurable value properties, not
 * getters, so they cannot be spied on directly.
 */
function stubHost(platform: NodeJS.Platform, arch: NodeJS.Architecture): () => void {
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
	const originalArch = Object.getOwnPropertyDescriptor(process, "arch")!;
	Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
	Object.defineProperty(process, "arch", { ...originalArch, value: arch });
	return () => {
		Object.defineProperty(process, "platform", originalPlatform);
		Object.defineProperty(process, "arch", originalArch);
	};
}

/**
 * Write a minimal staged payload. `target` is informational metadata copied
 * from the payload build and is not consumed by the packaging plan.
 */
function stageFakePayload(pluginRoot: string, target: string): void {
	const bridgeDir = path.join(pluginRoot, "resources", "bridge");
	const binaryDir = path.join(bridgeDir, "python", "bin");
	mkdirSync(binaryDir, { recursive: true });
	const binary = path.join(binaryDir, "python3.11");
	writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
	writeFileSync(
		path.join(bridgeDir, "manifest.json"),
		JSON.stringify({
			schema: 1,
			target,
			python_version: "3.11.12",
			bridge_version: "0.1.7",
			launch: ["python/bin/python3.11"],
			packages: {},
			natives: ["python/bin/python3.11"],
		}),
	);
}

describe("createBridgePackagingPlan", () => {
	it("returns extraResources when payload is staged", () => {
		const tempDir = makeTempDir();
		stageFakePayload(tempDir, "macos-arm64");

		const plan = createBridgePackagingPlan({
			pluginRoot: tempDir,
			platform: "darwin",
			arch: "arm64",
		});
		expect(plan.extraResources).toHaveLength(1);
		expect(plan.extraResources[0]).toBe(path.join(tempDir, "resources", "bridge"));
	});

	it("returns empty plan for genuinely unsupported platform", () => {
		const tempDir = makeTempDir();
		// darwin-x64 has no payload package registered
		const plan = createBridgePackagingPlan({
			pluginRoot: tempDir,
			platform: "darwin",
			arch: "x64",
		});
		expect(plan.extraResources).toEqual([]);
	});

	it("throws when win32-x64 payload is expected but not staged", () => {
		const tempDir = makeTempDir();
		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: "win32",
				arch: "x64",
			}),
		).toThrow(/desktop-bridge-payload-win32-x64.*staged/);
	});

	it("throws when linux-x64 payload is expected but not staged", () => {
		const tempDir = makeTempDir();
		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: "linux",
				arch: "x64",
			}),
		).toThrow(/desktop-bridge-payload-linux-x64.*staged/);
	});

	it("throws when darwin-arm64 payload is expected but not staged", () => {
		const tempDir = makeTempDir();
		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: "darwin",
				arch: "arm64",
			}),
		).toThrow(/desktop-bridge-payload-darwin-arm64.*staged/);
	});

	it("explains that a cross-platform build cannot resolve the payload", () => {
		const tempDir = makeTempDir();
		// Pick a supported target that is definitely not the host platform, so
		// the message must take the cross-build branch on every CI runner.
		const target = process.platform === "linux" ? "win32" : "linux";
		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: target,
				arch: "x64",
			}),
		).toThrow(/cross-platform build/);
	});

	it("treats an arch-only mismatch as a cross-platform build", () => {
		// A linux-arm64 host building linux-x64: the platform matches, but payload
		// packages are gated by cpu as well, so the target is just as unresolvable.
		// Both host values are stubbed so the assertion holds on every runner.
		const tempDir = makeTempDir();
		const restore = stubHost("linux", "arm64");
		try {
			expect(() =>
				createBridgePackagingPlan({ pluginRoot: tempDir, platform: "linux", arch: "x64" }),
			).toThrow(/cross-platform build/);
		} finally {
			restore();
		}
	});

	it.skipIf(!getPayloadPackageName())(
		"points a same-platform build at prepare-assets rather than the cross-build hint",
		() => {
			const tempDir = makeTempDir();
			expect(() =>
				createBridgePackagingPlan({
					pluginRoot: tempDir,
					platform: process.platform,
					arch: process.arch,
				}),
			).toThrow(/prepare-assets/);
			expect(() =>
				createBridgePackagingPlan({
					pluginRoot: tempDir,
					platform: process.platform,
					arch: process.arch,
				}),
			).not.toThrow(/cross-platform build/);
		},
	);

	it("succeeds for win32-x64 when payload is staged", () => {
		const tempDir = makeTempDir();
		stageFakePayload(tempDir, "win32-x64");

		const plan = createBridgePackagingPlan({
			pluginRoot: tempDir,
			platform: "win32",
			arch: "x64",
		});
		expect(plan.extraResources).toHaveLength(1);
	});

	it("succeeds for linux-x64 when payload is staged", () => {
		const tempDir = makeTempDir();
		stageFakePayload(tempDir, "linux-x64");

		const plan = createBridgePackagingPlan({
			pluginRoot: tempDir,
			platform: "linux",
			arch: "x64",
		});
		expect(plan.extraResources).toHaveLength(1);
	});

	it("throws when the staged manifest is malformed", () => {
		const tempDir = makeTempDir();
		const bridgeDir = path.join(tempDir, "resources", "bridge");
		mkdirSync(bridgeDir, { recursive: true });
		writeFileSync(path.join(bridgeDir, "manifest.json"), JSON.stringify({ schema: 1 }));

		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: "linux",
				arch: "x64",
			}),
		).toThrow(/Cannot read bridge manifest/);
	});

	it("throws when the launch binary is missing from a staged payload", () => {
		const tempDir = makeTempDir();
		const bridgeDir = path.join(tempDir, "resources", "bridge");
		mkdirSync(bridgeDir, { recursive: true });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({
				schema: 1,
				target: "linux-x64",
				python_version: "3.11.12",
				bridge_version: "0.1.7",
				launch: ["python/bin/python3.11"],
				packages: {},
				natives: [],
			}),
		);

		expect(() =>
			createBridgePackagingPlan({
				pluginRoot: tempDir,
				platform: "linux",
				arch: "x64",
			}),
		).toThrow(/launch binary not found/);
	});
});
