import { describe, expect, it, vi } from "vitest";

import type { PtyAdapter } from "./pty.js";
import {
	resolveShellCandidates,
	spawnFirstAvailableShell,
	terminalEnvironment,
} from "./shell-launch.js";

describe("terminal shell selection", () => {
	it("uses the user's POSIX shell before portable fallbacks", () => {
		expect(
			resolveShellCandidates("darwin", { SHELL: "/opt/homebrew/bin/fish" }).map(
				({ shell }) => shell,
			),
		).toEqual(["/opt/homebrew/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh", "zsh", "bash", "sh"]);
	});

	it("uses COMSPEC before PowerShell and cmd fallbacks", () => {
		const shells = resolveShellCandidates("win32", {
			COMSPEC: "D:\\Windows\\System32\\cmd.exe",
			SystemRoot: "D:\\Windows",
		}).map(({ shell }) => shell);
		expect(shells[0]).toBe("D:\\Windows\\System32\\cmd.exe");
		expect(shells).toContain("pwsh.exe");
		expect(shells).toContain("powershell.exe");
	});

	it("uses alternate and default Windows environment keys without duplicate candidates", () => {
		const alternate = resolveShellCandidates("win32", {
			ComSpec: "C:\\Windows\\System32\\cmd.exe",
			SYSTEMROOT: "C:\\Windows",
		}).map(({ shell }) => shell);
		expect(alternate[0]).toBe("C:\\Windows\\System32\\cmd.exe");
		expect(new Set(alternate).size).toBe(alternate.length);
		expect(resolveShellCandidates("win32", {})).toContainEqual({
			shell: "C:\\Windows\\System32\\cmd.exe",
			args: [],
		});
		expect(resolveShellCandidates("linux", { SHELL: "  " })[0]?.shell).toBe("/bin/zsh");
	});

	it("removes desktop-only variables and supplies truecolor terminal metadata", () => {
		expect(
			terminalEnvironment({
				PATH: "/usr/bin",
				ELECTRON_RUN_AS_NODE: "1",
				VITE_SECRET: "nope",
			}),
		).toEqual({
			PATH: "/usr/bin",
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			TERM_PROGRAM: "Kilo Desktop",
		});
	});

	it("ignores undefined and case-insensitive desktop environment variables", () => {
		expect(
			terminalEnvironment({
				UNSET: undefined,
				vite_internal: "hidden",
				electron_renderer_port: "hidden",
				USER_SETTING: "visible",
			}),
		).toMatchObject({
			USER_SETTING: "visible",
			TERM: "xterm-256color",
		});
	});

	it("falls through missing executables while retaining real spawn failures", () => {
		const process = { pid: 1 } as never;
		const spawn = vi
			.fn()
			.mockImplementationOnce(() => {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			})
			.mockReturnValue(process);
		const adapter = { spawn } satisfies PtyAdapter;
		expect(
			spawnFirstAvailableShell(adapter, { cwd: "/workspace", cols: 80, rows: 24, env: {} }, [
				{ shell: "/missing", args: [] },
				{ shell: "/bin/sh", args: [] },
			]),
		).toBe(process);
	});

	it("stops on real spawn failures and reports candidate exhaustion", () => {
		const options = { cwd: "/workspace", cols: 80, rows: 24, env: {} };
		const denied = new Error("permission denied");
		const deniedAdapter = {
			spawn: vi.fn(() => {
				throw denied;
			}),
		} satisfies PtyAdapter;
		expect(() =>
			spawnFirstAvailableShell(deniedAdapter, options, [{ shell: "/bin/sh", args: [] }]),
		).toThrow(denied);

		const missingAdapter = {
			spawn: vi.fn(() => {
				throw "not found";
			}),
		} satisfies PtyAdapter;
		expect(() =>
			spawnFirstAvailableShell(missingAdapter, options, [{ shell: "/missing", args: [] }]),
		).toThrow("No supported shell could be started.");
		expect(() => spawnFirstAvailableShell(missingAdapter, options, [])).toThrow(
			"No supported shell could be started.",
		);
	});
});
