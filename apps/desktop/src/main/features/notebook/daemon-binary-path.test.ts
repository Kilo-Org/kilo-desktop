import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDaemonBinaryPath } from "./daemon-binary-path.js";

const PACKAGED = {
	isPackaged: true,
	resourcesPath: "/Apps/Agentic.app/Contents/Resources",
	appPath: "/Apps/Agentic.app/Contents/Resources/app.asar",
};
const UNPACKAGED = {
	isPackaged: false,
	resourcesPath: "/repo/node_modules/electron/dist/Resources",
	appPath: "/repo/apps/desktop",
};

describe("resolveDaemonBinaryPath", () => {
	it("reads the sidecar out of resourcesPath in a packaged app", () => {
		// extraResource lands the file flat in Contents/Resources, beside the asar
		// rather than inside it — the fuses forbid loading a binary from the asar.
		expect(resolveDaemonBinaryPath({ ...PACKAGED, platform: "darwin", exists: () => true })).toBe(
			path.join(PACKAGED.resourcesPath, "runtimed-nightly"),
		);
	});

	it("reads the staged sidecar from the package root when unpackaged", () => {
		expect(resolveDaemonBinaryPath({ ...UNPACKAGED, platform: "darwin", exists: () => true })).toBe(
			"/repo/apps/desktop/build/daemon/runtimed-nightly",
		);
	});

	it("uses the stable asset name when the build channel is stable", () => {
		expect(
			resolveDaemonBinaryPath({
				...PACKAGED,
				platform: "darwin",
				environment: { RUNT_BUILD_CHANNEL: "stable" },
				exists: () => true,
			}),
		).toBe(path.join(PACKAGED.resourcesPath, "runtimed"));
	});

	it("expects a .exe on Windows", () => {
		expect(resolveDaemonBinaryPath({ ...PACKAGED, platform: "win32", exists: () => true })).toBe(
			path.join(PACKAGED.resourcesPath, "runtimed-nightly.exe"),
		);
	});

	it("is undefined when this build bundles no daemon", () => {
		// Not an error: an unreachable daemon is an expected state, and the app may
		// still attach to a separately installed one.
		expect(
			resolveDaemonBinaryPath({ ...PACKAGED, platform: "darwin", exists: () => false }),
		).toBeUndefined();
	});

	it("probes exactly one candidate, so a miss is unambiguous", () => {
		const probed: string[] = [];
		resolveDaemonBinaryPath({
			...PACKAGED,
			platform: "darwin",
			exists: (candidate) => {
				probed.push(candidate);
				return false;
			},
		});
		expect(probed).toEqual([path.join(PACKAGED.resourcesPath, "runtimed-nightly")]);
	});
});
