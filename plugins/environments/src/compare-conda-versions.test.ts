import { describe, expect, it } from "vitest";

import { compareCondaVersions } from "./compare-conda-versions.js";

/**
 * Behavioural checks for the shared version comparator. Each case pins one
 * branch of the algorithm — the comparator is small but reused across main
 * and renderer, so equivalence with conda's own dotted-component ordering
 * matters (repodata sort, upgradable detection, version picker).
 */
describe("compareCondaVersions", () => {
	it("returns 0 for identical version strings", () => {
		expect(compareCondaVersions("1.2.3", "1.2.3")).toBe(0);
	});

	it("orders numeric components numerically, not lexically", () => {
		// Lexical order would place "1.10" before "1.2".
		expect(compareCondaVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
		expect(compareCondaVersions("1.2.0", "1.10.0")).toBeLessThan(0);
	});

	it("treats a numeric component as greater than an alphabetic component", () => {
		// `1.1` > `1.1a` because a numeric segment outranks an alphabetic
		// segment at the same position (conda's own convention).
		expect(compareCondaVersions("1.1", "1.1a")).toBeGreaterThan(0);
		expect(compareCondaVersions("1.1a", "1.1")).toBeLessThan(0);
	});

	it("falls back to lexical comparison when both components are non-numeric", () => {
		expect(compareCondaVersions("1.beta", "1.alpha")).toBeGreaterThan(0);
		expect(compareCondaVersions("1.alpha", "1.beta")).toBeLessThan(0);
	});

	it("treats a missing trailing component as less than a present one", () => {
		// `1.2` < `1.2.0` because the shorter version is missing its third
		// component; the loop reports the shorter side as less.
		expect(compareCondaVersions("1.2", "1.2.0")).toBeLessThan(0);
		expect(compareCondaVersions("1.2.0", "1.2")).toBeGreaterThan(0);
	});

	it("splits components on '.', '-', and '_' interchangeably", () => {
		// The delimiter choice must not change the ordering — conda repodata
		// uses all three across the ecosystem.
		expect(compareCondaVersions("1.2.3", "1-2-3")).toBe(0);
		expect(compareCondaVersions("1_2_3", "1.2.3")).toBe(0);
	});
});
