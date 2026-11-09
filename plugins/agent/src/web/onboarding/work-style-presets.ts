type PermissionLevel = "allow" | "ask" | "deny";
type PermissionRule = PermissionLevel | null | Record<string, PermissionLevel | null>;
export type PermissionConfig = Partial<Record<string, PermissionRule>>;

/** Same values as the Kilo VS Code extension, so telemetry lines up across clients. */
export type WorkStyle = "human-in-the-loop" | "autonomous";

export const WORK_STYLE_CHOICES: readonly WorkStyle[] = ["human-in-the-loop", "autonomous"];

// Copied verbatim from kilocode packages/kilo-vscode/src/shared/work-style-presets.ts
// (the "human-in-the-loop" preset's `permission` block). Keep in sync with it.
const BASH: Record<string, PermissionLevel> = {
	"*": "ask",
	"cat *": "allow",
	"head *": "allow",
	"tail *": "allow",
	"less *": "allow",
	"ls *": "allow",
	"tree *": "allow",
	"pwd *": "allow",
	"echo *": "allow",
	"wc *": "allow",
	"which *": "allow",
	"type *": "allow",
	"file *": "allow",
	"diff *": "allow",
	"du *": "allow",
	"df *": "allow",
	"date *": "allow",
	"uname *": "allow",
	"whoami *": "allow",
	"printenv *": "allow",
	"man *": "allow",
	"grep *": "allow",
	"rg *": "allow",
	"ag *": "allow",
	"uniq *": "allow",
	"cut *": "allow",
	"tr *": "allow",
	"jq *": "allow",
	"*>*": "ask",
};

export const REVIEW_FIRST_PERMISSION: PermissionConfig = {
	read: {
		"*": "allow",
		"*.env": "ask",
		"*.env.*": "ask",
		"*.env.example": "allow",
	},
	grep: "allow",
	glob: "allow",
	list: "allow",
	question: "allow",
	webfetch: "allow",
	websearch: "allow",
	codesearch: "allow",
	external_directory: "ask",
	edit: "ask",
	bash: BASH,
	doom_loop: "ask",
};

export type WorkStylePatch = { permission: PermissionConfig };

/** What this onboarding run overwrote: each preset key's prior value (`undefined` = absent). */
export type AppliedWorkStyle = { previous: PermissionConfig };

export type WorkStylePlan = {
	/** Global-config patches to apply in order; empty when nothing should be written. */
	patches: WorkStylePatch[];
	/** This run's review-first write, if it is in the global config afterwards. */
	applied: AppliedWorkStyle | null;
};

const PRESET_KEYS = Object.keys(REVIEW_FIRST_PERMISSION);

/**
 * Decides what (if anything) to write to the user's global Kilo config.
 *
 * - Review first always wins: every key the preset defines is set to exactly
 *   the preset. Kilo merges pattern maps (`bash`, `read`) per pattern, so any
 *   existing pattern the preset lacks is sent as `null` (Kilo's delete
 *   sentinel) — one patch, no partial states. Keys the preset doesn't define
 *   (e.g. MCP tool rules) are left alone. The overwritten values are recorded.
 * - High autonomy writes nothing — Kilo's defaults apply. The one exception is
 *   undoing this run's own write: if the preset keys still hold exactly the
 *   preset, they are restored to what they were before — deleted first, then
 *   rewritten, because Kilo promotes a scalar to `{ "*": scalar }` when an
 *   object is merged over it, which would leave a stray `"*"`. Anything the
 *   user changed since is left alone.
 */
export function planWorkStylePatch(input: {
	style: WorkStyle;
	globalPermission: PermissionConfig | undefined;
	applied: AppliedWorkStyle | null;
}): WorkStylePlan {
	const current = input.globalPermission ?? {};
	if (input.style === "autonomous") {
		if (input.applied && holdsPreset(current)) {
			return { patches: restorePatches(input.applied.previous), applied: null };
		}
		return { patches: [], applied: null };
	}
	const applied = input.applied ?? { previous: pick(current, PRESET_KEYS) };
	if (holdsPreset(current)) return { patches: [], applied };
	return { patches: [{ permission: replaceKeys(current, REVIEW_FIRST_PERMISSION) }], applied };
}

/** Preset keys already set in the global config with values other than the preset's. */
export function conflictingPermissionKeys(permission: PermissionConfig | undefined): string[] {
	const current = permission ?? {};
	return PRESET_KEYS.filter(
		(key) => current[key] !== undefined && !isDeepEqual(current[key], REVIEW_FIRST_PERMISSION[key]),
	);
}

function holdsPreset(current: PermissionConfig): boolean {
	return PRESET_KEYS.every((key) => isDeepEqual(current[key], REVIEW_FIRST_PERMISSION[key]));
}

function restorePatches(previous: PermissionConfig): WorkStylePatch[] {
	const cleared = Object.fromEntries(PRESET_KEYS.map((key) => [key, null]));
	const restored = Object.fromEntries(
		PRESET_KEYS.flatMap((key) => (previous[key] == null ? [] : [[key, previous[key]]])),
	);
	return Object.keys(restored).length > 0
		? [{ permission: cleared }, { permission: restored }]
		: [{ permission: cleared }];
}

function pick(permission: PermissionConfig, keys: readonly string[]): PermissionConfig {
	return Object.fromEntries(keys.map((key) => [key, permission[key]]));
}

/**
 * A patch that leaves every preset key holding exactly `target[key]` after
 * Kilo's merge: absent targets delete the key, scalars replace, and pattern
 * maps null out any existing pattern the target lacks.
 */
function replaceKeys(current: PermissionConfig, target: PermissionConfig): PermissionConfig {
	const patch: PermissionConfig = {};
	for (const key of PRESET_KEYS) {
		const next = target[key];
		const existing = current[key];
		if (next === undefined || next === null) {
			patch[key] = null;
		} else if (typeof next === "string" || typeof existing !== "object" || existing === null) {
			patch[key] = next;
		} else {
			const stale = Object.keys(existing).filter((pattern) => !(pattern in next));
			patch[key] = { ...Object.fromEntries(stale.map((pattern) => [pattern, null])), ...next };
		}
	}
	return patch;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
		return false;
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every(
		(key) =>
			Object.hasOwn(right, key) &&
			isDeepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
	);
}
