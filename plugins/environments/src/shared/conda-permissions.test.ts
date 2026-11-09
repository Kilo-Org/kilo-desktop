import { describe, expect, it } from "vitest";

import {
	MUTATING_CONDA_TOOL_NAMES,
	buildCondaCliPermissionRules,
	condaPermissionAction,
	matchesMutatingCondaCli,
} from "./conda-permissions.js";

const MUTATING = [
	"desktop_environments_conda_envs_create",
	"desktop_environments_conda_envs_delete",
	"desktop_environments_conda_envs_clone",
	"desktop_environments_conda_packages_install",
	"desktop_environments_conda_packages_remove",
	"desktop_environments_conda_packages_update",
	"desktop_environments_conda_channels_add",
	"desktop_environments_conda_channels_remove",
] as const;

// Tools that must NOT be gated. `envs_createFromFile` mutates but is
// deliberately never exposed to the model (`tools.ts`), so it stays off the gate.
const NOT_GATED = [
	"desktop_environments_conda_envs_list",
	"desktop_environments_conda_packages_list",
	"desktop_environments_conda_channels_list",
	"desktop_environments_conda_repodata_find",
	"desktop_environments_conda_setup_open",
	"desktop_environments_conda_envs_createFromFile",
] as const;

describe("mutating conda tool permissions", () => {
	it("gates exactly the mutating conda tools, including channel add/remove", () => {
		expect([...MUTATING_CONDA_TOOL_NAMES].sort()).toEqual([...MUTATING].sort());
	});

	it("names the action each mutating tool's permission card asks about", () => {
		expect(condaPermissionAction("desktop_environments_conda_packages_install")).toBe(
			"installing conda packages",
		);
		for (const name of NOT_GATED) expect(condaPermissionAction(name)).toBeUndefined();
	});
});

describe("conda CLI (bash) permissions", () => {
	const rules = buildCondaCliPermissionRules();
	const patterns = rules.map((rule) => rule.pattern);

	it("asks before every mutating conda-family command", () => {
		expect(rules.every((rule) => rule.permission === "bash")).toBe(true);
		expect(rules.every((rule) => rule.action === "ask")).toBe(true);
	});

	it("covers install/create/update/remove for conda, mamba, and micromamba", () => {
		for (const binary of ["conda", "mamba", "micromamba"]) {
			for (const subcommand of ["install", "create", "update", "remove"]) {
				expect(patterns).toContain(`*${binary} ${subcommand}*`);
			}
		}
	});

	it("covers the env-namespace mutations", () => {
		expect(patterns).toContain("*conda env create*");
		expect(patterns).toContain("*conda env remove*");
	});

	it("uses a leading wildcard so absolute paths and compound commands match", () => {
		expect(patterns.every((pattern) => pattern.startsWith("*"))).toBe(true);
	});

	it("never denies outright — the prompt is the control", () => {
		expect(rules.some((rule) => rule.action === "deny")).toBe(false);
	});
});

describe("matchesMutatingCondaCli", () => {
	it("recognises mutating conda-family CLI commands", () => {
		for (const command of [
			"conda install numpy",
			"cd /tmp && conda install -p /env pkg.tar.bz2",
			"/opt/anaconda3/bin/conda create -n dev python=3.12",
			"mamba update numpy",
			"micromamba env create -f env.yml",
		]) {
			expect(matchesMutatingCondaCli(command)).toBe(true);
		}
	});

	it("ignores read-only or unrelated commands", () => {
		for (const command of ["conda list", "conda env list", "conda info", "rm -rf /tmp/x"]) {
			expect(matchesMutatingCondaCli(command)).toBe(false);
		}
	});

	it("keeps the substring semantics of the ask-rule globs", () => {
		// The rules match `*conda install*`, so a command that merely contains the
		// token also matches here — the same (accepted) false positive.
		expect(matchesMutatingCondaCli('git commit -m "conda install fix"')).toBe(true);
	});
});
