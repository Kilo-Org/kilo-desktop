import type { ResolvedColorScheme } from "../../themes/theme-tokens";

type Steps = readonly [number, number, number];

/** The designed steps (slider at 60%) for blocks 1, 2 and ≥3 away from the focused one. */
const DESIGNED: Record<ResolvedColorScheme, Steps> = {
	dark: [0.3, 0.22, 0.14],
	light: [0.34, 0.25, 0.16],
};
/** Strongest dimming (slider at 100%). */
const STRONGEST: Record<ResolvedColorScheme, Steps> = {
	dark: [0.12, 0.08, 0.05],
	light: [0.14, 0.1, 0.06],
};
const DESIGNED_AT = 0.6;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Text opacity of a block `distance` blocks from the focused one. Light
 * surfaces need a little more ink to read as the same step. Between 0 and the
 * designed 60% the steps ease in from full colour; above, towards the
 * strongest.
 */
export function blockOpacity(
	distance: number,
	dimming: number,
	scheme: ResolvedColorScheme,
): number {
	if (distance <= 0) return 1;
	const index = Math.min(distance, 3) - 1;
	const designed = DESIGNED[scheme][index]!;
	const strongest = STRONGEST[scheme][index]!;
	const s = Math.min(1, Math.max(0, dimming / 100));
	if (s <= DESIGNED_AT) return round(1 - ((1 - designed) * s) / DESIGNED_AT);
	return round(designed - ((designed - strongest) * (s - DESIGNED_AT)) / (1 - DESIGNED_AT));
}
