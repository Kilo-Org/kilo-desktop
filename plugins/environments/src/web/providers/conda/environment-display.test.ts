import { describe, expect, it } from "vitest";

import { basename, environmentDisplayName } from "./environment-display.js";

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
