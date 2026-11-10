import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { resolveBridge, resolveBridgeLaunchInfo } from "./resolveBridgePath";

const LAUNCH = ["python/bin/python3.11", "-E", "-s", "-P", "-B", "-m", "anaconda_desktop_bridge"];

function createPayload(
	bridgeDir: string,
	manifest: Record<string, unknown> = { bridge_version: "0.1.0", launch: LAUNCH },
	{ executable = true }: { executable?: boolean } = {},
): string {
	mkdirSync(path.join(bridgeDir, "python", "bin"), { recursive: true });
	const binary = path.join(bridgeDir, "python", "bin", "python3.11");
	writeFileSync(binary, "#!/bin/sh\n");
	chmodSync(binary, executable ? 0o755 : 0o644);
	writeFileSync(path.join(bridgeDir, "manifest.json"), JSON.stringify(manifest));
	return bridgeDir;
}

const noEnv = { BRIDGE_PAYLOAD: "" };

describe("resolving the bundled conda bridge", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), "bridge-test-"));
	});

	it("launches the payload in the plugin's bridge folder with an absolute interpreter", () => {
		const bridgeDir = createPayload(path.join(root, "resources", "bridge"));

		const info = resolveBridgeLaunchInfo({ bridgeDir, env: noEnv });

		expect(info).toEqual({
			command: [path.join(bridgeDir, "python", "bin", "python3.11"), ...LAUNCH.slice(1)],
			payloadRoot: bridgeDir,
			version: "0.1.0",
		});
	});

	it("prefers BRIDGE_PAYLOAD, and reports only it when it is invalid", () => {
		const bridgeDir = createPayload(path.join(root, "bundled"));
		const override = createPayload(path.join(root, "override"), {
			bridge_version: "9.9.9",
			launch: LAUNCH,
		});

		expect(resolveBridgeLaunchInfo({ bridgeDir, env: { BRIDGE_PAYLOAD: override } })?.version).toBe(
			"9.9.9",
		);
		expect(resolveBridge({ bridgeDir, env: { BRIDGE_PAYLOAD: path.join(root, "nope") } })).toEqual({
			kind: "not-found",
			searchedPaths: [path.join(root, "nope")],
		});
	});

	it("is not found without a folder, or with a missing or malformed payload", () => {
		expect(resolveBridge({ env: noEnv })).toEqual({ kind: "not-found", searchedPaths: [] });
		const missing = path.join(root, "missing");
		expect(resolveBridge({ bridgeDir: missing, env: noEnv })).toEqual({
			kind: "not-found",
			searchedPaths: [missing],
		});
		const empty = createPayload(path.join(root, "empty"), { bridge_version: "1", launch: [] });
		expect(resolveBridgeLaunchInfo({ bridgeDir: empty, env: noEnv })).toBeNull();
		const noLaunch = createPayload(path.join(root, "no-launch"), { bridge_version: "1" });
		expect(resolveBridgeLaunchInfo({ bridgeDir: noLaunch, env: noEnv })).toBeNull();
		writeFileSync(path.join(noLaunch, "manifest.json"), "{not json");
		expect(resolveBridgeLaunchInfo({ bridgeDir: noLaunch, env: noEnv })).toBeNull();
	});

	it.skipIf(process.platform === "win32")(
		"is not found when the interpreter is not executable",
		() => {
			const bridgeDir = createPayload(path.join(root, "plain"), undefined, { executable: false });

			expect(resolveBridgeLaunchInfo({ bridgeDir, env: noEnv })).toBeNull();
		},
	);
});
