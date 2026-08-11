import type { access as AccessFn } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSystemConda } from "./detectSystemConda.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("node:fs/promises");
	return { ...actual, access: vi.fn() };
});

import { execa } from "execa";
import { access } from "node:fs/promises";

const mockedExeca = vi.mocked(execa);
const mockedAccess = vi.mocked<typeof AccessFn>(access as typeof AccessFn);

function noopLogger() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

afterEach(() => {
	mockedExeca.mockReset();
	mockedAccess.mockReset();
});

describe("detectSystemConda", () => {
	it("returns system conda info when a compatible version is found on PATH", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which" && args[0] === "conda") {
				return Promise.resolve({ stdout: "/usr/local/bin/conda", exitCode: 0 });
			}
			if (cmd === "/usr/local/bin/conda" && args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "25.3.1", root_prefix: "/usr/local" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toEqual({
			condaBinPath: "/usr/local/bin/conda",
			version: "25.3.1",
		});
	});

	it("returns null when no conda is found on PATH or well-known paths", async () => {
		mockedExeca.mockImplementation((() => {
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);
		mockedAccess.mockRejectedValue(new Error("ENOENT"));

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toBeNull();
	});

	it("returns null when conda version is below minimum (24.0)", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/usr/bin/conda", exitCode: 0 });
			}
			if (args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "23.11.0" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toBeNull();
	});

	it("returns null when conda info fails to parse", async () => {
		mockedExeca.mockImplementation(((cmd: string) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/usr/bin/conda", exitCode: 0 });
			}
			return Promise.resolve({ stdout: "not json", exitCode: 0 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toBeNull();
	});

	it("accepts exact minimum version 24.0.0", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/opt/conda/bin/conda", exitCode: 0 });
			}
			if (args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "24.0.0" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toEqual({
			condaBinPath: "/opt/conda/bin/conda",
			version: "24.0.0",
		});
	});

	it("uses 'where' on Windows platform", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "where" && args[0] === "conda") {
				return Promise.resolve({
					stdout: "C:\\Users\\user\\miniconda3\\Scripts\\conda.exe",
					exitCode: 0,
				});
			}
			if (args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "25.1.0" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "win32" });

		expect(result).toEqual({
			condaBinPath: "C:\\Users\\user\\miniconda3\\Scripts\\conda.exe",
			version: "25.1.0",
		});
	});

	it("falls back to well-known paths when PATH search fails", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "", exitCode: 1 });
			}
			// conda info for the well-known path
			if (args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "24.5.0" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		// First well-known path check succeeds
		mockedAccess.mockResolvedValueOnce(undefined);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).not.toBeNull();
		expect(result!.version).toBe("24.5.0");
	});

	it("returns null when conda info returns empty version", async () => {
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/usr/bin/conda", exitCode: 0 });
			}
			if (args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ root_prefix: "/usr" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toBeNull();
	});

	it("returns null when execa throws for conda info", async () => {
		mockedExeca.mockImplementation(((cmd: string) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/usr/bin/conda", exitCode: 0 });
			}
			return Promise.reject(new Error("timeout"));
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger(), platform: "darwin" });

		expect(result).toBeNull();
	});
});
