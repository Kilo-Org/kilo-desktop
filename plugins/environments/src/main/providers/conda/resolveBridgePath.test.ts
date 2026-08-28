import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveBridgeBinaryPath, resolveBridgeLaunchInfo } from "./resolveBridgePath.js";

function createFakePayload(root: string): string {
	const bridgeDir = path.join(root, "resources", "bridge");
	mkdirSync(path.join(bridgeDir, "python", "bin"), { recursive: true });
	const binary = path.join(bridgeDir, "python", "bin", "python3.11");
	writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
	writeFileSync(
		path.join(bridgeDir, "manifest.json"),
		JSON.stringify({
			schema: 1,
			target: "darwin-arm64",
			bridge_version: "0.1.0",
			launch: ["python/bin/python3.11", "-E", "-s", "-P", "-B", "-m", "anaconda_desktop_bridge"],
			packages: {},
			macho: [],
		}),
	);
	return bridgeDir;
}

describe("resolveBridgeLaunchInfo", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), "bridge-test-"));
		vi.stubEnv("BRIDGE_PAYLOAD", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns null when no payload is found", () => {
		const result = resolveBridgeLaunchInfo({
			isPackaged: false,
			pluginRoot: path.join(tempDir, "nonexistent"),
		});
		expect(result).toBeNull();
	});

	it("resolves from plugin resources in dev mode", () => {
		createFakePayload(tempDir);
		const result = resolveBridgeLaunchInfo({
			isPackaged: false,
			pluginRoot: tempDir,
		});
		expect(result).not.toBeNull();
		expect(result!.version).toBe("0.1.0");
		expect(result!.command[0]).toBe(
			path.join(tempDir, "resources", "bridge", "python", "bin", "python3.11"),
		);
		expect(result!.command.slice(1)).toEqual([
			"-E",
			"-s",
			"-P",
			"-B",
			"-m",
			"anaconda_desktop_bridge",
		]);
	});

	it("resolves from resourcesPath in packaged mode", () => {
		const resourcesPath = path.join(tempDir, "app-resources");
		const bridgeDir = path.join(resourcesPath, "bridge");
		mkdirSync(path.join(bridgeDir, "python", "bin"), { recursive: true });
		const binary = path.join(bridgeDir, "python", "bin", "python3.11");
		writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({
				schema: 1,
				target: "darwin-arm64",
				bridge_version: "0.2.0",
				launch: ["python/bin/python3.11", "-E", "-m", "anaconda_desktop_bridge"],
				packages: {},
				macho: [],
			}),
		);

		const result = resolveBridgeLaunchInfo({
			isPackaged: true,
			resourcesPath,
		});
		expect(result).not.toBeNull();
		expect(result!.version).toBe("0.2.0");
		expect(result!.payloadRoot).toBe(bridgeDir);
	});

	it("resolves from BRIDGE_PAYLOAD env var", () => {
		const bridgeDir = path.join(tempDir, "custom-payload");
		mkdirSync(path.join(bridgeDir, "python", "bin"), { recursive: true });
		const binary = path.join(bridgeDir, "python", "bin", "python3.11");
		writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({
				schema: 1,
				target: "darwin-arm64",
				bridge_version: "0.3.0",
				launch: ["python/bin/python3.11", "-m", "anaconda_desktop_bridge"],
				packages: {},
				macho: [],
			}),
		);

		vi.stubEnv("BRIDGE_PAYLOAD", bridgeDir);
		const result = resolveBridgeLaunchInfo();
		expect(result).not.toBeNull();
		expect(result!.version).toBe("0.3.0");
	});

	it("returns null when manifest has empty launch array", () => {
		// Stage the fixture where the resolver actually looks
		// (<pluginRoot>/resources/bridge) so the empty-`launch` branch in
		// buildLaunchInfo is exercised — not the "directory missing" branch.
		const bridgeDir = path.join(tempDir, "resources", "bridge");
		mkdirSync(bridgeDir, { recursive: true });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({ schema: 1, bridge_version: "0.1.0", launch: [], packages: {}, macho: [] }),
		);

		const result = resolveBridgeLaunchInfo({
			isPackaged: false,
			pluginRoot: tempDir,
		});
		expect(result).toBeNull();
	});

	it("returns null when manifest is parseable but missing the launch field", () => {
		// A malformed-but-parseable manifest must fall back to null, not throw
		// an uncaught TypeError up through CondaProvider.boot().
		const bridgeDir = path.join(tempDir, "resources", "bridge");
		mkdirSync(bridgeDir, { recursive: true });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({ schema: 1, bridge_version: "0.1.0", packages: {}, macho: [] }),
		);

		expect(() => resolveBridgeLaunchInfo({ isPackaged: false, pluginRoot: tempDir })).not.toThrow();
		expect(resolveBridgeLaunchInfo({ isPackaged: false, pluginRoot: tempDir })).toBeNull();
	});

	it("returns null when binary does not exist", () => {
		const bridgeDir = path.join(tempDir, "resources", "bridge");
		mkdirSync(bridgeDir, { recursive: true });
		writeFileSync(
			path.join(bridgeDir, "manifest.json"),
			JSON.stringify({
				schema: 1,
				bridge_version: "0.1.0",
				launch: ["python/bin/python3.11", "-m", "bridge"],
				packages: {},
				macho: [],
			}),
		);
		// Don't create the binary

		const result = resolveBridgeLaunchInfo({ isPackaged: false, pluginRoot: tempDir });
		expect(result).toBeNull();
	});
});

describe("resolveBridgeBinaryPath", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), "bridge-compat-"));
		vi.stubEnv("BRIDGE_PAYLOAD", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns the binary path when payload exists", () => {
		createFakePayload(tempDir);
		const result = resolveBridgeBinaryPath({ isPackaged: false, pluginRoot: tempDir });
		expect(result).toBe(path.join(tempDir, "resources", "bridge", "python", "bin", "python3.11"));
	});

	it("returns null when no payload exists", () => {
		const result = resolveBridgeBinaryPath({
			isPackaged: false,
			pluginRoot: path.join(tempDir, "nope"),
		});
		expect(result).toBeNull();
	});
});
