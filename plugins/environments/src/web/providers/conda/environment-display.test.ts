import { describe, expect, it } from "vitest";

import {
	basename,
	environmentDisplayName,
	suggestEnvironmentName,
	validateEnvironmentName,
} from "./environment-display";

describe("basename", () => {
	it("returns the last POSIX segment", () => {
		expect(basename("/opt/anaconda3")).toBe("anaconda3");
		expect(basename("/Users/me/miniconda3/envs/dev")).toBe("dev");
	});

	it("returns the last Windows segment", () => {
		expect(basename("C:\\Users\\me\\miniconda3")).toBe("miniconda3");
		expect(basename("C:\\Users\\me\\miniconda3\\envs\\dev")).toBe("dev");
	});

	it("ignores trailing separators", () => {
		expect(basename("/opt/anaconda3/")).toBe("anaconda3");
		expect(basename("C:\\conda\\")).toBe("conda");
	});

	it("returns an empty string for a root path", () => {
		expect(basename("/")).toBe("");
	});

	it("returns the input when there is no separator", () => {
		expect(basename("anaconda3")).toBe("anaconda3");
	});
});

describe("environmentDisplayName", () => {
	it("prefers conda's own name", () => {
		expect(environmentDisplayName({ name: "dev", prefix: "/opt/conda/envs/dev" })).toBe("dev");
	});

	it("falls back to the prefix directory when conda reports no name", () => {
		// The real payload that made every nameless env render as "base".
		expect(environmentDisplayName({ name: "", prefix: "/opt/anaconda3" })).toBe("anaconda3");
		expect(environmentDisplayName({ name: "", prefix: "/Users/me/miniconda3" })).toBe("miniconda3");
		expect(
			environmentDisplayName({
				name: "",
				prefix: "/Users/me/micromamba/envs/metaflow/osx-arm64/274d89d70b0c6fd",
			}),
		).toBe("274d89d70b0c6fd");
	});

	it("keeps nameless sibling environments distinguishable", () => {
		const a = environmentDisplayName({ name: "", prefix: "/projects/v4/env" });
		const b = environmentDisplayName({ name: "", prefix: "/projects/v4/env_local" });
		expect(a).toBe("env");
		expect(b).toBe("env_local");
		expect(a).not.toBe(b);
	});

	it("falls back to 'base' when the prefix yields nothing", () => {
		expect(environmentDisplayName({ name: "", prefix: "/" })).toBe("base");
		expect(environmentDisplayName({ name: "", prefix: "" })).toBe("base");
	});
});

describe("validateEnvironmentName", () => {
	it("accepts conda-legal names", () => {
		expect(validateEnvironmentName("py311")).toBeNull();
		expect(validateEnvironmentName("data.science_1-0")).toBeNull();
	});

	it("rejects empty and pattern-violating names", () => {
		expect(validateEnvironmentName("")).toBe("Name is required.");
		expect(validateEnvironmentName("has space")).toMatch(/must start with a letter or digit/);
		expect(validateEnvironmentName("-lead")).toMatch(/must start with a letter or digit/);
	});

	it("enforces the contract's 128-character maximum", () => {
		expect(validateEnvironmentName("a".repeat(128))).toBeNull();
		expect(validateEnvironmentName("a".repeat(129))).toBe("Name must be 128 characters or fewer.");
	});
});

describe("suggestEnvironmentName", () => {
	const env = (name: string, prefix = `/opt/anaconda3/envs/${name}`) => ({ name, prefix });

	function expectValid(name: string) {
		expect(validateEnvironmentName(name)).toBeNull();
		return name;
	}

	it("names a new environment after the package it is made for", () => {
		expect(expectValid(suggestEnvironmentName("numpy", []))).toBe("numpy");
		expect(suggestEnvironmentName("scikit-learn", [env("dev"), env("data")])).toBe("scikit-learn");
	});

	it("adds the first free number when an environment already uses the name", () => {
		expect(suggestEnvironmentName("numpy", [env("numpy")])).toBe("numpy-2");
		expect(suggestEnvironmentName("numpy", [env("numpy"), env("numpy-2"), env("numpy-4")])).toBe(
			"numpy-3",
		);
	});

	it("compares names without case, as macOS and Windows folders do", () => {
		expect(suggestEnvironmentName("numpy", [env("NumPy")])).toBe("numpy-2");
	});

	it("counts nameless environments by their folder", () => {
		expect(suggestEnvironmentName("numpy", [env("", "/Users/me/projects/numpy")])).toBe("numpy-2");
	});

	it("never suggests conda's reserved names", () => {
		expect(suggestEnvironmentName("base", [])).toBe("base-2");
		expect(suggestEnvironmentName("root", [])).toBe("root-2");
	});

	it("turns a package name conda would refuse into a valid environment name", () => {
		expect(expectValid(suggestEnvironmentName("_libgcc_mutex", []))).toBe("libgcc_mutex");
		expect(expectValid(suggestEnvironmentName("___", []))).toBe("env");
		const long = suggestEnvironmentName("a".repeat(200), [env("a".repeat(120))]);
		expectValid(long);
		expect(long.length).toBeLessThanOrEqual(128);
	});
});
