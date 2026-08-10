import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSystemConda } from "./detectSystemConda.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

import { execa } from "execa";

const mockedExeca = vi.mocked(execa);

function noopLogger() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

afterEach(() => {
	mockedExeca.mockReset();
});

describe("detectSystemConda", () => {
	it("returns system conda info when a compatible version is found on PATH", async () => {
		// Mock `which conda` → returns a path
		mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
			if (cmd === "which" && args[0] === "conda") {
				return Promise.resolve({ stdout: "/usr/local/bin/conda", exitCode: 0 });
			}
			// Mock `conda info --json`
			if (cmd === "/usr/local/bin/conda" && args[0] === "info") {
				return Promise.resolve({
					stdout: JSON.stringify({ conda_version: "25.3.1", root_prefix: "/usr/local" }),
					exitCode: 0,
				});
			}
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger() });

		expect(result).toEqual({
			condaBinPath: "/usr/local/bin/conda",
			version: "25.3.1",
		});
	});

	it("returns null when no conda is found", async () => {
		// Mock `which` fails, and access checks fail for well-known paths
		mockedExeca.mockImplementation((() => {
			return Promise.resolve({ stdout: "", exitCode: 1 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger() });

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

		const result = await detectSystemConda({ logger: noopLogger() });

		expect(result).toBeNull();
	});

	it("returns null when conda info fails to parse", async () => {
		mockedExeca.mockImplementation(((cmd: string) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "/usr/bin/conda", exitCode: 0 });
			}
			// conda info returns invalid JSON
			return Promise.resolve({ stdout: "not json", exitCode: 0 });
			// oxlint-disable-next-line no-explicit-any
		}) as any);

		const result = await detectSystemConda({ logger: noopLogger() });

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

		const result = await detectSystemConda({ logger: noopLogger() });

		expect(result).toEqual({
			condaBinPath: "/opt/conda/bin/conda",
			version: "24.0.0",
		});
	});
});
