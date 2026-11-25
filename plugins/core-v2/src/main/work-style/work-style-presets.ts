import type { PermissionRule } from "@kilocode/client";

import type { WorkStyle } from "../../contracts";

/** Rules of Kilo's ordered `permissions` list; the last matching rule wins. */
export type { PermissionRule };

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

// Copied verbatim from kilocode origin/v2 packages/kilo-vscode/src/shared/work-style-presets.ts
// (`HUMAN_PERMISSIONS`, the "human-in-the-loop" preset). Keep in sync with it.
export const REVIEW_FIRST_RULES: readonly PermissionRule[] = [
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

/** What this session's Review first replaced: the rules it held for the preset's actions. */
export type AppliedWorkStyle = { readonly previous: readonly PermissionRule[] };

export type WorkStylePlan = {
	/** The whole `permissions` list to write; undefined when nothing should be written. */
	readonly permissions: readonly PermissionRule[] | undefined;
	/** This session's Review first write, if it is in the config afterwards. */
	readonly applied: AppliedWorkStyle | null;
};

const PRESET_ACTIONS: ReadonlySet<string> = new Set(REVIEW_FIRST_RULES.map((rule) => rule.action));

function isPresetAction(rule: PermissionRule): boolean {
	return PRESET_ACTIONS.has(rule.action);
}

function sameRule(left: PermissionRule, right: PermissionRule): boolean {
	return (
		left.action === right.action && left.resource === right.resource && left.effect === right.effect
	);
}

/** The preset's actions hold exactly the preset's rules, in its order. */
function holdsPreset(rules: readonly PermissionRule[]): boolean {
	const preset = rules.filter(isPresetAction);
	return (
		preset.length === REVIEW_FIRST_RULES.length &&
		preset.every((rule, index) => sameRule(rule, REVIEW_FIRST_RULES[index]!))
	);
}

/**
 * Decides what (if anything) to write to the user's global `permissions`.
 *
 * - Review first always wins: the rules for the preset's actions (`read`,
 *   `edit`, `external_directory`, `shell`) are replaced by the preset's, at the
 *   end of the list so they win over earlier rules; rules for other actions
 *   (MCP tools, Desktop's own) stay where they are. The replaced rules are
 *   recorded.
 * - High autonomy writes nothing, so Kilo's defaults apply. The one exception
 *   is undoing this session's own write: if the preset's actions still hold
 *   exactly the preset, their earlier rules come back. Anything the user
 *   changed since is left alone.
 */
export function planWorkStyle(input: {
	style: WorkStyle;
	permissions: readonly PermissionRule[] | undefined;
	applied: AppliedWorkStyle | null;
}): WorkStylePlan {
	const current = input.permissions ?? [];
	const others = current.filter((rule) => !isPresetAction(rule));
	if (input.style === "autonomous") {
		if (input.applied && holdsPreset(current)) {
			return { permissions: [...others, ...input.applied.previous], applied: null };
		}
		return { permissions: undefined, applied: null };
	}
	const applied = input.applied ?? { previous: current.filter(isPresetAction) };
	if (holdsPreset(current)) return { permissions: undefined, applied };
	return { permissions: [...others, ...REVIEW_FIRST_RULES], applied };
}

/** Actions of the preset that already have rules other than the preset's. */
export function conflictingPermissionActions(
	permissions: readonly PermissionRule[] | undefined,
): string[] {
	const conflicting = (permissions ?? []).filter(
		(rule) => isPresetAction(rule) && !REVIEW_FIRST_RULES.some((preset) => sameRule(preset, rule)),
	);
	return [...new Set(conflicting.map((rule) => rule.action))];
}
