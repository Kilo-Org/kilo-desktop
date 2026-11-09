import { describe, expect, it } from "vitest";

import { ExecError } from "./errors.js";
import { parseGitVersion, satisfies } from "./version.js";

describe("parseGitVersion", () => {
	it("parses a plain version string", () => {
		expect(parseGitVersion("git version 2.53.0\n")).toBe("2.53.0");
	});

	it("coerces a Git for Windows version string", () => {
		expect(parseGitVersion("git version 2.53.0.windows.4\n")).toBe("2.53.0");
	});

	it("coerces an Apple Git version string", () => {
		expect(parseGitVersion("git version 2.39.5 (Apple Git-154)\n")).toBe("2.39.5");
	});

	it("pads partial versions into semver", () => {
		expect(parseGitVersion("git version 2.53\n")).toBe("2.53.0");
	});

	it("throws ExecError for unparseable output", () => {
		expect(() => parseGitVersion("not git output")).toThrowError(ExecError);
	});
});

describe("satisfies", () => {
	it("returns true for a satisfied range", () => {
		expect(satisfies("2.23.0", ">=2.23")).toBe(true);
	});

	it("returns false for an unsatisfied range", () => {
		expect(satisfies("2.22.9", ">=2.23")).toBe(false);
	});

	it("handles caret ranges", () => {
		expect(satisfies("2.53.0", "^2.19")).toBe(true);
	});
});
