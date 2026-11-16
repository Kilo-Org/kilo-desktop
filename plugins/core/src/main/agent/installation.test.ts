import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveKiloInstallation } from "./installation.js";

describe("resolveKiloInstallation", () => {
	it("uses the first injected resource root containing the target binary", () => {
		const developmentExecutable = path.join("/development", "darwin-arm64", "bin", "kilo");
		expect(
			resolveKiloInstallation({
				resourceRoots: ["/packaged", "/development"],
				environment: {},
				platform: "darwin",
				arch: "arm64",
				exists: (candidate) => candidate === developmentExecutable,
			}),
		).toEqual({
			executablePath: developmentExecutable,
			treeSitterWasmDirectory: path.join("/development", "darwin-arm64", "bin", "tree-sitter"),
		});
	});

	it("prefers an explicit local executable without consulting resource roots", () => {
		const exists = () => {
			throw new Error("resource roots should not be inspected");
		};
		expect(
			resolveKiloInstallation({
				resourceRoots: [],
				environment: { KILO_CODE_CLI_PATH: " ./local-kilo " },
				platform: "darwin",
				arch: "arm64",
				exists,
			}),
		).toEqual({
			executablePath: path.resolve("./local-kilo"),
			treeSitterWasmDirectory: path.join(path.dirname(path.resolve("./local-kilo")), "tree-sitter"),
			custom: true,
		});
	});

	it("fails clearly when none of the injected roots contains Kilo", () => {
		expect(() =>
			resolveKiloInstallation({
				resourceRoots: ["/missing"],
				environment: {},
				platform: "darwin",
				arch: "arm64",
				exists: () => false,
			}),
		).toThrow("Bundled Kilo CLI is missing from the configured resource roots");
	});

	it("falls back to process.env for the CLI path override", () => {
		const previous = process.env.KILO_CODE_CLI_PATH;
		process.env.KILO_CODE_CLI_PATH = " ./env-kilo ";
		try {
			// Omitting `environment` exercises the `?? process.env` default.
			expect(
				resolveKiloInstallation({
					resourceRoots: [],
					platform: "darwin",
					arch: "arm64",
				}),
			).toEqual({
				executablePath: path.resolve("./env-kilo"),
				treeSitterWasmDirectory: path.join(path.dirname(path.resolve("./env-kilo")), "tree-sitter"),
				custom: true,
			});
		} finally {
			if (previous === undefined) delete process.env.KILO_CODE_CLI_PATH;
			else process.env.KILO_CODE_CLI_PATH = previous;
		}
	});

	it("falls back to existsSync when no exists probe is injected", () => {
		const previous = process.env.KILO_CODE_CLI_PATH;
		delete process.env.KILO_CODE_CLI_PATH;
		try {
			// Omitting `exists` exercises the `?? existsSync` default; a bogus root
			// does not exist on disk, so resolution reports the missing bundle.
			expect(() =>
				resolveKiloInstallation({
					resourceRoots: ["/definitely/not/a/real/resource/root"],
					platform: "darwin",
					arch: "arm64",
				}),
			).toThrow("Bundled Kilo CLI is missing from the configured resource roots");
		} finally {
			if (previous !== undefined) process.env.KILO_CODE_CLI_PATH = previous;
		}
	});
});
