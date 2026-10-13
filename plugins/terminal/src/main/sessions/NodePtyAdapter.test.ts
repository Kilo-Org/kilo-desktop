import { describe, expect, it } from "vitest";

import { parseWindowsBuildNumber, resolveNodePtySpawnOptions } from "./NodePtyAdapter.js";
import type { PtySpawnOptions } from "./pty.js";

const spawnOptions: PtySpawnOptions = {
	shell: "shell",
	args: [],
	cwd: "/workspace",
	cols: 120,
	rows: 30,
	env: { TERM: "xterm-256color" },
};

describe("resolveNodePtySpawnOptions", () => {
	it.each([22631, 18309])("uses the bundled ConPTY DLL on Windows build %i", (build) => {
		expect(resolveNodePtySpawnOptions(spawnOptions, "win32", build)).toEqual({
			cwd: "/workspace",
			cols: 120,
			rows: 30,
			env: { TERM: "xterm-256color" },
			name: "xterm-color",
			useConptyDll: true,
		});
	});

	it.each([18308, 17763, undefined])("falls back to the OS ConPTY on Windows build %s", (build) => {
		expect(resolveNodePtySpawnOptions(spawnOptions, "win32", build)).toMatchObject({
			useConptyDll: false,
		});
	});

	it.each(["darwin", "linux"] as const)("passes no ConPTY option on %s", (platform) => {
		const options = resolveNodePtySpawnOptions(spawnOptions, platform, undefined);
		expect(options).not.toHaveProperty("useConptyDll");
		expect(options.name).toBe("xterm-256color");
	});
});

describe("parseWindowsBuildNumber", () => {
	it("reads the build from a Windows os.release() string", () => {
		expect(parseWindowsBuildNumber("10.0.22631")).toBe(22631);
	});

	it.each(["", "10.0", "10.0.abc", "garbage"])("returns undefined for %j", (release) => {
		expect(parseWindowsBuildNumber(release)).toBeUndefined();
	});
});
