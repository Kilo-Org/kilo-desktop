import type { PermissionRule, WorkStyle } from "../../contracts";

// Copied from kilocode's v2 packages/kilo-vscode/src/shared/work-style-presets.ts
// (`HUMAN_PERMISSIONS`). Keep in sync with it.
const SHELL_ALLOW = [
	"cat *",
	"head *",
	"tail *",
	"less *",
	"ls *",
	"tree *",
	"pwd *",
	"echo *",
	"wc *",
	"which *",
	"type *",
	"file *",
	"diff *",
	"du *",
	"df *",
	"date *",
	"uname *",
	"whoami *",
	"printenv *",
	"man *",
	"grep *",
	"rg *",
	"ag *",
	"uniq *",
	"cut *",
	"tr *",
	"jq *",
];

/** Review first: ask before edits, commands and leaving the workspace, with read-only exceptions. */
export const REVIEW_FIRST_PERMISSIONS: readonly PermissionRule[] = [
	{ action: "read", resource: "*", effect: "allow" },
	{ action: "read", resource: "*.env", effect: "ask" },
	{ action: "read", resource: "*.env.*", effect: "ask" },
	{ action: "read", resource: "*.env.example", effect: "allow" },
	{ action: "edit", resource: "*", effect: "ask" },
	{ action: "external_directory", resource: "*", effect: "ask" },
	{ action: "shell", resource: "*", effect: "ask" },
	...SHELL_ALLOW.map((resource): PermissionRule => ({
		action: "shell",
		resource,
		effect: "allow",
	})),
	{ action: "shell", resource: "*>*", effect: "ask" },
];

/** What this run replaced: the user's global `permissions` before review first was written. */
export type AppliedWorkStyle = { previous: readonly PermissionRule[] };

export type WorkStylePlan = {
	/** The global `permissions` to write; undefined when nothing should be written. */
	permissions: readonly PermissionRule[] | undefined;
	/** This run's review-first write, if it is in the global config afterwards. */
	applied: AppliedWorkStyle | null;
};

const PRESET_ACTIONS = new Set(REVIEW_FIRST_PERMISSIONS.map((rule) => rule.action));

function sameRule(left: PermissionRule, right: PermissionRule): boolean {
	return (
		left.action === right.action && left.resource === right.resource && left.effect === right.effect
	);
}

/** Whether `rules` ends with exactly the review-first preset. */
function endsWithPreset(rules: readonly PermissionRule[]): boolean {
	const offset = rules.length - REVIEW_FIRST_PERMISSIONS.length;
	return (
		offset >= 0 &&
		REVIEW_FIRST_PERMISSIONS.every((rule, index) => sameRule(rule, rules[offset + index]!))
	);
}

/**
 * Decides what (if anything) to write to the user's global Kilo config, whose
 * `permissions` Kilo v2 reads as an ordered list where the last matching rule
 * wins.
 *
 * - Review first always wins: the preset is appended after the user's rules,
 *   so it decides every action it covers while the user's other rules (an MCP
 *   tool's, say) still apply. The list it replaced is recorded.
 * - High autonomy writes nothing — Kilo's defaults apply. The one exception is
 *   undoing this run's own write: if the rules still end with exactly the
 *   preset, the recorded list is restored. Anything the user changed since is
 *   left alone.
 */
export function planWorkStylePatch(input: {
	style: WorkStyle;
	globalPermissions: readonly PermissionRule[] | undefined;
	applied: AppliedWorkStyle | null;
}): WorkStylePlan {
	const current = input.globalPermissions ?? [];
	if (input.style === "autonomous") {
		if (input.applied && endsWithPreset(current)) {
			return { permissions: input.applied.previous, applied: null };
		}
		return { permissions: undefined, applied: null };
	}
	if (endsWithPreset(current)) {
		return {
			permissions: undefined,
			applied: input.applied ?? { previous: current.slice(0, -REVIEW_FIRST_PERMISSIONS.length) },
		};
	}
	return {
		permissions: [...current, ...REVIEW_FIRST_PERMISSIONS],
		applied: input.applied ?? { previous: current },
	};
}

/**
 * Actions with the user's own global rules that applying review first would
 * override, in first-seen order; none once the preset already ends the rules.
 */
export function conflictingPermissionKeys(
	permissions: readonly PermissionRule[] | undefined,
): string[] {
	const current = permissions ?? [];
	if (endsWithPreset(current)) return [];
	return [
		...new Set(
			current.filter((rule) => PRESET_ACTIONS.has(rule.action)).map((rule) => rule.action),
		),
	];
}
