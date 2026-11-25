import { describe, expect, it } from "vitest";

import type { PermissionRule } from "../../contracts";
import {
	conflictingPermissionKeys,
	planWorkStylePatch,
	REVIEW_FIRST_PERMISSIONS,
} from "./work-style-presets";

const USER_RULES: PermissionRule[] = [
	{ action: "shell", resource: "*", effect: "allow" },
	{ action: "read", resource: "secrets/*", effect: "deny" },
	{ action: "atlassian_searchJiraIssuesUsingJql", resource: "*", effect: "allow" },
];

/** What Kilo v2 decides: the last matching rule (exact names, `*` resources only, enough here). */
function effectOf(rules: readonly PermissionRule[], action: string, resource: string) {
	return rules.findLast(
		(rule) =>
			rule.action === action &&
			(rule.resource === "*" ||
				rule.resource === resource ||
				resource.startsWith(rule.resource.replace("*", ""))),
	)?.effect;
}

describe("planWorkStylePatch", () => {
	it("writes the review-first rules into a global config with none", () => {
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermissions: undefined,
			applied: null,
		});

		expect(plan.permissions).toEqual(REVIEW_FIRST_PERMISSIONS);
		expect(plan.applied).toEqual({ previous: [] });
		expect(effectOf(plan.permissions!, "edit", "src/a.ts")).toBe("ask");
		expect(effectOf(plan.permissions!, "shell", "rm -rf build")).toBe("ask");
	});

	it("appends the preset after the user's rules so it wins, keeping the user's other rules", () => {
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermissions: USER_RULES,
			applied: null,
		});

		expect(plan.permissions).toEqual([...USER_RULES, ...REVIEW_FIRST_PERMISSIONS]);
		expect(plan.applied).toEqual({ previous: USER_RULES });
		expect(effectOf(plan.permissions!, "shell", "rm -rf build")).toBe("ask");
		expect(effectOf(plan.permissions!, "atlassian_searchJiraIssuesUsingJql", "x")).toBe("allow");
	});

	it("writes nothing when the preset already ends the rules, keeping this run's record", () => {
		const applied = { previous: USER_RULES };
		const plan = planWorkStylePatch({
			style: "human-in-the-loop",
			globalPermissions: [...USER_RULES, ...REVIEW_FIRST_PERMISSIONS],
			applied,
		});

		expect(plan).toEqual({ permissions: undefined, applied });
	});

	it("for high autonomy writes nothing, so Kilo's defaults apply", () => {
		expect(
			planWorkStylePatch({ style: "autonomous", globalPermissions: USER_RULES, applied: null }),
		).toEqual({ permissions: undefined, applied: null });
	});

	it("undoes this run's review-first write when switching to high autonomy", () => {
		const plan = planWorkStylePatch({
			style: "autonomous",
			globalPermissions: [...USER_RULES, ...REVIEW_FIRST_PERMISSIONS],
			applied: { previous: USER_RULES },
		});

		expect(plan).toEqual({ permissions: USER_RULES, applied: null });
	});

	it("leaves rules the user changed after review first alone", () => {
		const changed = [
			...REVIEW_FIRST_PERMISSIONS,
			{ action: "edit", resource: "*", effect: "allow" as const },
		];
		expect(
			planWorkStylePatch({
				style: "autonomous",
				globalPermissions: changed,
				applied: { previous: [] },
			}),
		).toEqual({ permissions: undefined, applied: null });
	});
});

describe("conflictingPermissionKeys", () => {
	it("names the actions whose own rules review first would override", () => {
		expect(conflictingPermissionKeys(USER_RULES)).toEqual(["shell", "read"]);
		expect(conflictingPermissionKeys(undefined)).toEqual([]);
		expect(conflictingPermissionKeys(REVIEW_FIRST_PERMISSIONS)).toEqual([]);
	});
});
