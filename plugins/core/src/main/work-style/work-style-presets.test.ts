import { describe, expect, it } from "vitest";

import {
	conflictingPermissionKeys,
	planWorkStylePatch,
	REVIEW_FIRST_PERMISSION,
	type PermissionConfig,
} from "./work-style-presets";
import { mergePermission as applyKiloMerge } from "./test-work-style-client";

const MACHINE_RULES: PermissionConfig = {
	bash: "allow",
	read: { "*": "allow", "secrets/*": "deny" },
	external_directory: { "/Users/me/*": "allow", "/tmp/*": "allow" },
	atlassian_searchJiraIssuesUsingJql: { "*": "allow" },
};

describe("planWorkStylePatch", () => {
	it("writes the review-first block into a global config with no permission rules", () => {
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: undefined,
			applied: null,
		});

		expect(applyKiloMerge({}, plan.patches[0]!.permission)).toEqual(REVIEW_FIRST_PERMISSION);
		expect(plan.patches[0]?.permission).toMatchObject({
			edit: "ask",
			external_directory: "ask",
			read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
			bash: { "*": "ask", "ls *": "allow", "*>*": "ask" },
		});
		expect(plan.applied).not.toBeNull();
	});

	it("overrides existing machine rules for every preset key, keeping unrelated tool rules", () => {
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: MACHINE_RULES,
			applied: null,
		});

		const after = applyKiloMerge(MACHINE_RULES, plan.patches[0]!.permission);
		expect(after).toEqual({
			...REVIEW_FIRST_PERMISSION,
			atlassian_searchJiraIssuesUsingJql: { "*": "allow" },
		});
		expect(plan.applied?.previous).toMatchObject({
			bash: "allow",
			read: { "*": "allow", "secrets/*": "deny" },
			external_directory: { "/Users/me/*": "allow", "/tmp/*": "allow" },
			edit: undefined,
		});
	});

	it("writes nothing when the preset is already in place, keeping this run's record", () => {
		const applied = { previous: { bash: "allow" as const } };
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: structuredClone(REVIEW_FIRST_PERMISSION),
			applied,
		});

		expect(plan).toEqual({ patches: [], applied });
	});

	it("writes nothing for high autonomy, leaving Kilo's defaults in place", () => {
		expect(
			planWorkStylePatch({ style: "autonomous", globalPermission: undefined, applied: null }),
		).toEqual({ patches: [], applied: null });
		expect(
			planWorkStylePatch({ style: "autonomous", globalPermission: MACHINE_RULES, applied: null }),
		).toEqual({ patches: [], applied: null });
	});

	it("restores the replaced machine rules when switching to high autonomy", () => {
		const review = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: MACHINE_RULES,
			applied: null,
		});
		const written = applyKiloMerge(MACHINE_RULES, review.patches[0]!.permission);

		const revert = planWorkStylePatch({
			style: "autonomous",
			globalPermission: written,
			applied: review.applied,
		});

		expect(revert.applied).toBeNull();
		expect(
			revert.patches.reduce((config, patch) => applyKiloMerge(config, patch.permission), written),
		).toEqual(MACHINE_RULES);
	});

	it("removes the block entirely when there were no rules before", () => {
		const review = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: undefined,
			applied: null,
		});
		const written = applyKiloMerge({}, review.patches[0]!.permission);

		const revert = planWorkStylePatch({
			style: "autonomous",
			globalPermission: written,
			applied: review.applied,
		});

		expect(
			revert.patches.reduce((config, patch) => applyKiloMerge(config, patch.permission), written),
		).toEqual({});
	});

	it("does not restore once the written rules have been changed since", () => {
		const review = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermission: MACHINE_RULES,
			applied: null,
		});
		const changed = {
			...applyKiloMerge(MACHINE_RULES, review.patches[0]!.permission),
			edit: "allow" as const,
		};

		expect(
			planWorkStylePatch({
				style: "autonomous",
				globalPermission: changed,
				applied: review.applied,
			}),
		).toEqual({ patches: [], applied: null });
	});
});

describe("conflictingPermissionKeys", () => {
	it("lists preset keys the global config sets to something else", () => {
		expect(conflictingPermissionKeys(undefined)).toEqual([]);
		expect(conflictingPermissionKeys(structuredClone(REVIEW_FIRST_PERMISSION))).toEqual([]);
		expect(conflictingPermissionKeys(MACHINE_RULES)).toEqual([
			"read",
			"external_directory",
			"bash",
		]);
		expect(conflictingPermissionKeys({ atlassian_searchJiraIssuesUsingJql: "allow" })).toEqual([]);
	});
});
