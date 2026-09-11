import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { inspectForegroundProcess, normalizeProcessLabel } from "./process-activity.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockProcessListing(stdout: string, error: Error | null = null): void {
	vi.mocked(execFile).mockImplementation(((
		_command: string,
		_args: readonly string[],
		_options: object,
		callback: ExecFileCallback,
	) => {
		callback(error, stdout, "");
		return {} as ReturnType<typeof execFile>;
	}) as typeof execFile);
}

beforeEach(() => {
	vi.mocked(execFile).mockReset();
});

describe("normalizeProcessLabel", () => {
	it("uses the executable name for POSIX and Windows process listings", () => {
		expect(normalizeProcessLabel("/opt/homebrew/bin/vite", "darwin")).toBe("vite");
		expect(normalizeProcessLabel("C:\\nodejs\\node.exe", "win32")).toBe("node");
		expect(normalizeProcessLabel("[python]", "linux")).toBe("python");
		expect(normalizeProcessLabel("(ruby)", "linux")).toBe("ruby");
		expect(normalizeProcessLabel("   ", "linux")).toBeNull();
	});
});

describe("inspectForegroundProcess", () => {
	it("rejects invalid terminal process ids without spawning an inspector", async () => {
		await expect(inspectForegroundProcess(0, "linux")).resolves.toBeNull();
		expect(execFile).not.toHaveBeenCalled();
	});

	it("finds a direct child in a POSIX process listing", async () => {
		mockProcessListing("1 0 launchd\n42 7 /usr/local/bin/vite\n");

		await expect(inspectForegroundProcess(7, "darwin")).resolves.toBe("vite");
		expect(execFile).toHaveBeenCalledWith(
			"ps",
			["-eo", "pid=,ppid=,comm="],
			expect.objectContaining({ encoding: "utf8" }),
			expect.any(Function),
		);
	});

	it("finds a direct child in a Windows process listing", async () => {
		mockProcessListing("100|7|node.exe\r\n");

		await expect(inspectForegroundProcess(7, "win32")).resolves.toBe("node");
		expect(execFile).toHaveBeenCalledWith(
			"powershell.exe",
			expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
			expect.objectContaining({ encoding: "utf8" }),
			expect.any(Function),
		);
	});

	it("returns null when inspection fails or has no direct child", async () => {
		mockProcessListing("", new Error("inspection failed"));
		await expect(inspectForegroundProcess(7, "linux")).resolves.toBeNull();

		mockProcessListing("not a process\n42|8|node.exe\n");
		await expect(inspectForegroundProcess(7, "win32")).resolves.toBeNull();
	});
});
