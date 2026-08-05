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
});
