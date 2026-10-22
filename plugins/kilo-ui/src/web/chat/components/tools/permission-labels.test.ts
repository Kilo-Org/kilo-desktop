import { describe, expect, it } from "vitest";

import { describePermissionAction, visiblePermissionPatterns } from "./permission-labels.js";

describe("describePermissionAction", () => {
	it("maps every mutating conda tool to friendly phrasing", () => {
		expect(describePermissionAction("desktop_environments_conda_envs_create")).toBe(
			"creating a conda environment",
		);
		expect(describePermissionAction("desktop_environments_conda_envs_delete")).toBe(
			"deleting a conda environment",
		);
		expect(describePermissionAction("desktop_environments_conda_envs_clone")).toBe(
			"cloning a conda environment",
		);
		expect(describePermissionAction("desktop_environments_conda_packages_install")).toBe(
			"installing conda packages",
		);
		expect(describePermissionAction("desktop_environments_conda_packages_remove")).toBe(
			"removing conda packages",
		);
		expect(describePermissionAction("desktop_environments_conda_packages_update")).toBe(
			"updating conda packages",
		);
		expect(describePermissionAction("desktop_environments_conda_channels_add")).toBe(
			"adding a conda channel",
		);
		expect(describePermissionAction("desktop_environments_conda_channels_remove")).toBe(
			"removing a conda channel",
		);
	});

	it("returns undefined for unmapped tools so the caller falls back to the raw name", () => {
		expect(describePermissionAction("bash")).toBeUndefined();
		expect(describePermissionAction("desktop_environments_conda_envs_list")).toBeUndefined();
	});
});

describe("visiblePermissionPatterns", () => {
	it("drops the bare wildcard", () => {
		expect(visiblePermissionPatterns(["*"])).toEqual([]);
	});

	it("keeps meaningful patterns and drops only the wildcard", () => {
		expect(visiblePermissionPatterns(["/tmp/out.ipynb", "*"])).toEqual(["/tmp/out.ipynb"]);
	});

	it("passes through when there are no patterns", () => {
		expect(visiblePermissionPatterns([])).toEqual([]);
	});
});
