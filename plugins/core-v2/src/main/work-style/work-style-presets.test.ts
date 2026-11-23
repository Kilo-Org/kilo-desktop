import { describe, expect, it } from "vitest";

import {
	conflictingPermissionActions,
	planWorkStyle,
	REVIEW_FIRST_RULES,
	type PermissionRule,
} from "./work-style-presets";

const MCP_ALLOW: PermissionRule = {
	action: "atlassian_searchJiraIssuesUsingJql",
	resource: "*",
	effect: "allow",
};

const MACHINE_RULES: readonly PermissionRule[] = [
	{ action: "shell", resource: "*", effect: "allow" },
	MCP_ALLOW,
	{ action: "read", resource: "*", effect: "allow" },
	{ action: "read", resource: "secrets/*", effect: "deny" },
	{ action: "external_directory", resource: "/tmp/*", effect: "allow" },
];

describe("planWorkStyle", () => {
	it("writes the Review first rules into a config with no permission rules", () => {
		const plan = planWorkStyle({
			style: "human-in-the-loop",
			permissions: undefined,
			applied: null,
		});

		expect(plan.permissions).toEqual(REVIEW_FIRST_RULES);
		expect(plan.permissions).toContainEqual({ action: "shell", resource: "ls *", effect: "allow" });
		expect(plan.applied).toEqual({ previous: [] });
	});

	it("replaces the rules of every preset action at the end, keeping other rules in place", () => {
		const plan = planWorkStyle({
			style: "human-in-the-loop",
			permissions: MACHINE_RULES,
			applied: null,
		});

		expect(plan.permissions).toEqual([MCP_ALLOW, ...REVIEW_FIRST_RULES]);
		expect(plan.applied?.previous).toEqual(MACHINE_RULES.filter((rule) => rule !== MCP_ALLOW));
	});

	it("writes nothing when the preset is already in place, keeping this session's record", () => {
		const applied = { previous: [MACHINE_RULES[0]!] };
		const plan = planWorkStyle({
			style: "human-in-the-loop",
			permissions: [MCP_ALLOW, ...REVIEW_FIRST_RULES],
			applied,
		});

		expect(plan).toEqual({ permissions: undefined, applied });
	});

	it("restores the replaced rules for High autonomy after this session's Review first", () => {
		const first = planWorkStyle({
			style: "human-in-the-loop",
			permissions: MACHINE_RULES,
			applied: null,
		});
		const back = planWorkStyle({
			style: "autonomous",
			permissions: first.permissions,
			applied: first.applied,
		});

		expect(back.permissions).toEqual([
			MCP_ALLOW,
			...MACHINE_RULES.filter((rule) => rule !== MCP_ALLOW),
		]);
		expect(back.applied).toBeNull();
	});

	it("leaves the config alone for High autonomy without this session's Review first", () => {
		expect(
			planWorkStyle({ style: "autonomous", permissions: REVIEW_FIRST_RULES, applied: null }),
		).toEqual({ permissions: undefined, applied: null });
	});

	it("leaves rules the user changed after Review first alone for High autonomy", () => {
		const changed = [
			...REVIEW_FIRST_RULES,
			{ action: "edit", resource: "*", effect: "allow" } as const,
		];
		expect(
			planWorkStyle({ style: "autonomous", permissions: changed, applied: { previous: [] } }),
		).toEqual({ permissions: undefined, applied: null });
	});
});

describe("conflictingPermissionActions", () => {
	it("names each preset action with a rule the preset lacks, once", () => {
		expect(conflictingPermissionActions(MACHINE_RULES)).toEqual([
			"shell",
			"read",
			"external_directory",
		]);
	});

	it("ignores the preset's own rules and rules for other actions", () => {
		expect(conflictingPermissionActions([MCP_ALLOW, ...REVIEW_FIRST_RULES])).toEqual([]);
		expect(conflictingPermissionActions(undefined)).toEqual([]);
	});
});
