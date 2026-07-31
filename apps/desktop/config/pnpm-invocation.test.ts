import { describe, expect, it } from "vitest";

import { resolvePnpmInvocation } from "./pnpm-invocation.js";

describe("resolvePnpmInvocation", () => {
	const args = ["--filter", "@anaconda-agentic-desktop/desktop", "deploy"];

	it("runs pnpm directly on POSIX platforms", () => {
		expect(resolvePnpmInvocation(args, "linux", {})).toEqual({
			file: "pnpm",
			args,
		});
	});

	it("runs the pnpm command shim through the Windows command processor", () => {
		expect(
			resolvePnpmInvocation(args, "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }),
		).toEqual({
			file: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", "pnpm.cmd", ...args],
		});
	});

	it("falls back to cmd.exe when ComSpec is unavailable", () => {
		expect(resolvePnpmInvocation(args, "win32", {})).toEqual({
			file: "cmd.exe",
			args: ["/d", "/s", "/c", "pnpm.cmd", ...args],
		});
	});
});
